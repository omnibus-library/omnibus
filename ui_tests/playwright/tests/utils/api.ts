import type { Page, Request, Response } from "@playwright/test";
import { expect } from "../fixtures/test";

export type MutationMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** A request a test can force to fail: any mutation, or a read. */
export interface ForcedRequest {
  method: "GET" | MutationMethod;
  url: string | RegExp;
}

export interface ExpectMutationOptions {
  method: MutationMethod;
  url: string | RegExp;
  expectedBody?: unknown;
  expectedStatus?: number;
  /**
   * How long to wait for the request to fire, in ms (default 5000). Raise it
   * when the mutation is triggered by a full page load rather than a click —
   * e.g. the reader's settled-restore progress POST, which waits out
   * hydration, the epub render, and the relocate debounce.
   */
  timeout?: number;
}

// Arms waiters for a mutating request + its response, runs the user action
// that triggers the call, then asserts payload and status. Every POST / PUT /
// PATCH / DELETE the UI performs must go through this helper before any UI
// assertion — it guarantees the test observed the network contract and waited
// for the response to land before polling the DOM.
export async function expectMutation<T>(
  page: Page,
  opts: ExpectMutationOptions,
  action: () => Promise<T>,
): Promise<{ result: T; request: Request; response: Response }> {
  // RegExp.test() is stateful when the pattern has the `g` or `y` flag, which
  // would cause intermittent misses across repeated calls. Strip those flags.
  const urlPattern =
    typeof opts.url === "string"
      ? null
      : new RegExp(opts.url.source, opts.url.flags.replace(/[gy]/g, ""));
  const matchesUrl = (candidate: string) =>
    urlPattern === null
      ? candidate.includes(opts.url as string)
      : urlPattern.test(candidate);

  const requestPromise = page.waitForRequest(
    (r) => r.method() === opts.method && matchesUrl(r.url()),
    { timeout: opts.timeout ?? 5_000 },
  );

  const result = await action();
  const request = await requestPromise;
  // Pair the response to the specific request we captured — using request.response()
  // guarantees the pairing even if concurrent mutations (retries, double-click,
  // background autosave) produce additional matching requests.
  const response = await request.response();
  if (!response) {
    throw new Error(`No response received for ${opts.method} ${request.url()}`);
  }

  if (opts.expectedBody !== undefined) {
    expect(request.postDataJSON()).toEqual(opts.expectedBody);
  }
  if (opts.expectedStatus !== undefined) {
    expect(response.status()).toBe(opts.expectedStatus);
  }

  return { result, request, response };
}

/** A `waitForResponse` predicate matching the response to a POST to `url`. */
export function isPostTo(url: RegExp): (response: Response) => boolean {
  return (response) =>
    response.request().method() === "POST" && url.test(response.url());
}

/** Returns `contract` expecting the 500 a forced-failure stub answers with. */
export function failing(
  contract: ExpectMutationOptions,
): ExpectMutationOptions {
  return { ...contract, expectedStatus: 500 };
}

/**
 * Parks the requests to `url` that `parks` accepts until the returned release
 * runs; requests that arrive after it pass straight through.
 */
export async function holdRequests(
  page: Page,
  url: string | RegExp | ((url: URL) => boolean),
  parks: (request: Request) => boolean = () => true,
): Promise<() => void> {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    if (parks(route.request())) await gate;
    await route.continue();
  });
  return release;
}

/**
 * Methods of every request to `url` from now on, so a test can show a
 * cancelled confirm sent nothing.
 */
export function recordRequests(page: Page, url: RegExp): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (url.test(request.url())) seen.push(request.method());
  });
  return seen;
}

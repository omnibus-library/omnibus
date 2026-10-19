import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { BookUuid } from "./api";
import {
  applyAutoReadStatus,
  autoTransition,
  useAutoReadStatus,
} from "./autoReadStatus";
import { deferred } from "./testing/handlers";
import { aWireReadStatus } from "./testing/wire";

const BOOK = "book-a" as BookUuid;

describe("autoTransition", () => {
  it.each([
    ["unread", false, "reading"],
    ["reading", false, null],
    ["finished", false, null],
    ["unread", true, "finished"],
    ["reading", true, "finished"],
    ["finished", true, null],
  ] as const)("moves %s at atEnd=%s to %s", (current, atEnd, next) => {
    expect(autoTransition(current, atEnd)).toBe(next);
  });
});

describe("useAutoReadStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets the server store finished last when reading is still in flight", async () => {
    const held = deferred();
    const stored: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "PUT") return Response.json(null);
        const { status } = JSON.parse(String(init.body));
        if (status === "reading") await held.promise;
        stored.push(status);
        return Response.json(aWireReadStatus({ status }));
      }),
    );

    const { rerender } = renderHook(
      ({ atEnd }) => useAutoReadStatus(BOOK, atEnd),
      { initialProps: { atEnd: false } },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    rerender({ atEnd: true });
    held.release();

    await waitFor(() => expect(stored).toEqual(["reading", "finished"]));
  });
});

describe("applyAutoReadStatus", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  /** A server holding `stored` (or failing the read); returns the PUT bodies it was sent. */
  function serve(stored: "unread" | "finished" | "failed") {
    const puts: unknown[] = [];
    server.use(
      http.get("/api/read-status/:uuid", () =>
        stored === "failed"
          ? new HttpResponse("no", { status: 500 })
          : HttpResponse.json(
              stored === "unread" ? null : aWireReadStatus({ status: stored }),
            ),
      ),
      http.put("/api/read-status", async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(aWireReadStatus({ status: "reading" }));
      }),
    );
    return puts;
  }

  it("marks a book with no status reading on its first play", async () => {
    const puts = serve("unread");

    await applyAutoReadStatus(BOOK, false);

    expect(puts).toEqual([{ book_uuid: BOOK, status: "reading" }]);
  });

  it("writes nothing when the status could not be read, so finished is never downgraded", async () => {
    const puts = serve("failed");

    await applyAutoReadStatus(BOOK, false);

    expect(puts).toEqual([]);
  });

  it("marks a book finished at its end", async () => {
    const puts = serve("unread");

    await applyAutoReadStatus(BOOK, true);

    expect(puts).toEqual([{ book_uuid: BOOK, status: "finished" }]);
  });

  it("leaves a finished book finished at its end", async () => {
    const puts = serve("finished");

    await applyAutoReadStatus(BOOK, true);

    expect(puts).toEqual([]);
  });
});

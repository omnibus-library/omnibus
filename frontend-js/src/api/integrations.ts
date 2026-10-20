import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  clearSmtpConfig,
  getEbookConvert,
  getGoogleBooksKey,
  getHardcoverKey,
  getMcp,
  getPostMcpUrl,
  getSmtpConfig,
  getTestSmtpConfigUrl,
  postEbookConvert,
  postGoogleBooksKey,
  postHardcoverKey,
  setSmtpConfig,
} from "./generated/omnibus";
import type {
  EbookConvertStatus,
  HardcoverKeyStatus,
  SmtpConfigStatus,
  SmtpConfigUpdate,
} from "./generated/schemas";

export type {
  EbookConvertStatus,
  SmtpConfigStatus,
  SmtpConfigUpdate,
} from "./generated/schemas";

// The Integrations section's reads and writes. Every query key starts with "admin".

/** The relay Send to Kindle emails through; its password comes back masked. */
export const smtpConfigQuery = queryOptions({
  queryKey: ["admin", "smtp"],
  queryFn: async () => ok(await getSmtpConfig()),
});

/** Replaces the relay; answers what the server now holds. */
export async function saveSmtpConfig(
  update: SmtpConfigUpdate,
): Promise<SmtpConfigStatus> {
  return ok(await setSmtpConfig(update));
}

/** Removes the saved relay, host, sign-in and password; answers what is left. */
export async function resetSmtpConfig(): Promise<SmtpConfigStatus> {
  return ok(await clearSmtpConfig());
}

/** Sends a test email to the signed-in account's Kindle address through the relay. */
export async function sendSmtpTest() {
  // The route answers with no body, so the generated fetcher would JSON-parse a refusal's plain text.
  await send(getTestSmtpConfigUrl(), "POST");
}

/** The server-wide keys the admin sets: the Hardcover token and the Google Books key. */
export type SecretKeyKind = "hardcover" | "google-books";

/** A key's state with the key masked; the two wire types are the same shape. */
export type SecretKeyStatus = HardcoverKeyStatus;

/** Whether a server-wide key is set, where it came from, and its masked preview. */
export const secretKeyQuery = (kind: SecretKeyKind) =>
  queryOptions({
    queryKey: ["admin", "secret-key", kind],
    queryFn: async (): Promise<SecretKeyStatus> =>
      kind === "hardcover"
        ? ok(await getHardcoverKey())
        : ok(await getGoogleBooksKey()),
  });

/** Saves a key, or removes it with `null`; answers what the server now holds. */
export async function saveSecretKey(
  kind: SecretKeyKind,
  key: string | null,
): Promise<SecretKeyStatus> {
  return kind === "hardcover"
    ? ok(await postHardcoverKey({ key }))
    : ok(await postGoogleBooksKey({ key }));
}

/** The Calibre `ebook-convert` the server resolved, and where it found it. */
export const ebookConvertQuery = queryOptions({
  queryKey: ["admin", "ebook-convert"],
  queryFn: async () => ok(await getEbookConvert()),
});

/** Saves the `ebook-convert` path, or goes back to auto-detection with `null`. */
export async function saveEbookConvert(
  path: string | null,
): Promise<EbookConvertStatus> {
  return ok(await postEbookConvert({ path }));
}

/** Whether the hosted `/mcp` endpoint is on. */
export const mcpQuery = queryOptions({
  queryKey: ["admin", "mcp"],
  queryFn: async () => ok(await getMcp()),
});

/** Turns the hosted `/mcp` endpoint on or off. */
export async function setMcpEnabled(enabled: boolean) {
  // The route answers with no body, so the generated fetcher would JSON-parse a refusal's plain text.
  await send(getPostMcpUrl(), "POST", { enabled });
}

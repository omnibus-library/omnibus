import type { ExpectMutationOptions } from "../utils/api";

/** The cross-format endpoints the sync row, the modal and the player post to. */
export const crossFormatUrls = {
  link: /\/api\/rpc\/cross-format\/link(?:\?|$)/,
  unlink: /\/api\/rpc\/cross-format\/unlink(?:\?|$)/,
  follow: /\/api\/rpc\/cross-format\/follow(?:\?|$)/,
  syncPoint: /\/api\/rpc\/cross-format\/sync-point(?:\?|$)/,
  alignment: /\/api\/rpc\/cross-format\/alignment(?:\?|$)/,
};

function write(url: RegExp, body?: unknown): ExpectMutationOptions {
  return { method: "POST", url, expectedBody: body, expectedStatus: 200 };
}

/** The writes a reader makes to pair a book's ebook and audio. */
export const crossFormat = {
  /** The confirm in the alignment modal. */
  link: (): ExpectMutationOptions => write(crossFormatUrls.link),

  unlink: (): ExpectMutationOptions => write(crossFormatUrls.unlink),

  /** The follow switch's write. */
  follow: (bookUuid: string, enabled: boolean): ExpectMutationOptions =>
    write(crossFormatUrls.follow, { uuid: bookUuid, body: { enabled } }),

  /** The player's "sync here" declaration. */
  syncPoint: (): ExpectMutationOptions => write(crossFormatUrls.syncPoint),
};

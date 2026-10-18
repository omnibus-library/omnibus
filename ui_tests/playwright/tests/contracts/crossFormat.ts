import { type ExpectMutationOptions, post } from "../utils/api";

/** The cross-format endpoints the sync row, the modal and the player post to. */
export const crossFormatUrls = {
  link: /\/api\/rpc\/cross-format\/link(?:\?|$)/,
  unlink: /\/api\/rpc\/cross-format\/unlink(?:\?|$)/,
  follow: /\/api\/rpc\/cross-format\/follow(?:\?|$)/,
  syncPoint: /\/api\/rpc\/cross-format\/sync-point(?:\?|$)/,
  alignment: /\/api\/rpc\/cross-format\/alignment(?:\?|$)/,
};

/** The writes a reader makes to pair a book's ebook and audio. */
export const crossFormat = {
  /** The confirm in the alignment modal. */
  link: (): ExpectMutationOptions => post(crossFormatUrls.link),

  unlink: (): ExpectMutationOptions => post(crossFormatUrls.unlink),

  /** The follow switch's write. */
  follow: (bookUuid: string, enabled: boolean): ExpectMutationOptions =>
    post(crossFormatUrls.follow, { uuid: bookUuid, body: { enabled } }),

  /** The player's "sync here" declaration. */
  syncPoint: (): ExpectMutationOptions => post(crossFormatUrls.syncPoint),

  /** The alignment re-read that follows a flip, a POST that changes nothing. */
  alignment: (): ExpectMutationOptions => post(crossFormatUrls.alignment),
};

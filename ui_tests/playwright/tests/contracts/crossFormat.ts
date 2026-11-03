import {
  type ExpectMutationOptions,
  type ForcedRequest,
  post,
} from "../utils/api";

/** The cross-format endpoints the sync row, the modal and the player call. */
export const crossFormatUrls = {
  link: /\/api\/books\/[^/]+\/cross-format-link(?:\?|$)/,
  follow: /\/api\/books\/[^/]+\/cross-format-follow(?:\?|$)/,
  syncPoint: /\/api\/books\/[^/]+\/sync-point(?:\?|$)/,
  alignment: /\/api\/books\/[^/]+\/alignment(?:\?|$)/,
};

/** The writes a reader makes to pair a book's ebook and audio. */
export const crossFormat = {
  /** The confirm in the alignment modal. */
  link: (): ExpectMutationOptions => post(crossFormatUrls.link, undefined, 204),

  unlink: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: crossFormatUrls.link,
    expectedStatus: 204,
  }),

  /** The follow switch's write on the book `bookUuid`. */
  follow: (bookUuid: string, enabled: boolean): ExpectMutationOptions =>
    post(
      new RegExp(`/api/books/${bookUuid}/cross-format-follow(?:\\?|$)`),
      { enabled },
      204,
    ),

  /** The player's "sync here" declaration. */
  syncPoint: (): ExpectMutationOptions =>
    post(crossFormatUrls.syncPoint, undefined, 204),

  /** The alignment re-read that follows a flip. */
  alignment: (): ForcedRequest => ({
    method: "GET",
    url: crossFormatUrls.alignment,
  }),
};

import type { ExpectMutationOptions } from "../utils/api";

/** The cover endpoints the edit page and the edition picker write to. */
export const coversUrls = {
  fromUrl: /\/api\/ebooks\/[^/]+\/cover\/from-url(?:\?|$)/,
  revert: /\/api\/rpc\/ebook\/cover\/delete(?:\?|$)/,
};

function fromUrlOf(bookUuid: string): RegExp {
  return new RegExp(`/api/ebooks/${bookUuid}/cover/from-url(?:\\?|$)`);
}

/** The writes that change a book's cover override. */
export const covers = {
  /** Applies the image at `url` as `bookUuid`'s cover. */
  fromUrl: (bookUuid: string, url: string): ExpectMutationOptions => ({
    method: "POST",
    url: fromUrlOf(bookUuid),
    expectedBody: { url },
    expectedStatus: 200,
  }),

  /** The same write, answered 400 as the server does a disallowed host. */
  fromUrlRefused: (bookUuid: string): ExpectMutationOptions => ({
    method: "POST",
    url: fromUrlOf(bookUuid),
    expectedStatus: 400,
  }),

  /** Drops the cover override and keeps the field overrides. */
  revert: (): ExpectMutationOptions => ({
    method: "POST",
    url: coversUrls.revert,
    expectedStatus: 200,
  }),
};

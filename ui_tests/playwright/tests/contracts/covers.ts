import { type ExpectMutationOptions, post } from "../utils/api";

/** The cover endpoints the edit page and the edition picker write to. */
export const coversUrls = {
  fromUrl: /\/api\/ebooks\/[^/]+\/cover\/from-url(?:\?|$)/,
  revert: /\/api\/ebooks\/[^/]+\/cover(?:\?|$)/,
};

function fromUrlOf(bookUuid: string): RegExp {
  return new RegExp(`/api/ebooks/${bookUuid}/cover/from-url(?:\\?|$)`);
}

/** The writes that change a book's cover override. */
export const covers = {
  /** Applies the image at `url` as `bookUuid`'s cover. */
  fromUrl: (bookUuid: string, url: string): ExpectMutationOptions =>
    post(fromUrlOf(bookUuid), { url }),

  /** The same write, answered 400 as the server does a disallowed host. */
  fromUrlRefused: (bookUuid: string): ExpectMutationOptions =>
    post(fromUrlOf(bookUuid), undefined, 400),

  /** Drops the cover override and keeps the field overrides. */
  revert: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: coversUrls.revert,
    expectedStatus: 200,
  }),
};

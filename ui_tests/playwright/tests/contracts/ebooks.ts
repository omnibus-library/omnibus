import type { ExpectMutationOptions } from "../utils/api";

/** The library listing endpoint the landing page reads. */
export const ebooksUrls = {
  page: /\/api\/rpc\/ebooks\/page(?:\?|$)/,
};

/** The landing page's keyset page read, a POST that changes nothing. */
export const ebooks = {
  /** A read a full page load triggers passes a longer `timeout`. */
  page: (timeout?: number): ExpectMutationOptions => ({
    method: "POST",
    url: ebooksUrls.page,
    expectedStatus: 200,
    timeout,
  }),
};

import type { ExpectMutationOptions } from "../utils/api";

/** The library listing endpoint the landing page reads. */
export const ebooksUrls = {
  page: /\/api\/rpc\/ebooks\/page(?:\?|$)/,
};

/** The landing page's keyset page read, a POST that changes nothing. */
export const ebooks = {
  page: (): ExpectMutationOptions => ({
    method: "POST",
    url: ebooksUrls.page,
    expectedStatus: 200,
  }),
};

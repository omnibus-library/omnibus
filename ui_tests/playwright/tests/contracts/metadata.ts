import type { MetadataOverrides } from "../data/ebooks";
import type { ExpectMutationOptions } from "../utils/api";

/** The metadata endpoint a book page posts to. */
export const metadataUrls = {
  saveOverrides: /\/api\/rpc\/ebook\/overrides$/,
};

/** The writes a book page makes on a book's metadata. */
export const metadata = {
  saveOverrides: (
    bookUuid: string,
    overrides: MetadataOverrides,
  ): ExpectMutationOptions => ({
    method: "POST",
    url: metadataUrls.saveOverrides,
    expectedBody: { uuid: bookUuid, overrides },
    expectedStatus: 200,
  }),
};

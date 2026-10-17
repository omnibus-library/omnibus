import type { ExpectMutationOptions } from "../utils/api";

/** The Kindle endpoints a book page posts to. */
export const kindleUrls = {
  send: /\/api\/rpc\/kindle\/send$/,
  status: /\/api\/rpc\/kindle\/send\/status$/,
};

/** The writes a book page makes to send a book to a Kindle. */
export const kindle = {
  send: (bookUuid: string): ExpectMutationOptions => ({
    method: "POST",
    url: kindleUrls.send,
    expectedBody: { book_uuid: bookUuid, file_id: null },
    expectedStatus: 200,
  }),
};

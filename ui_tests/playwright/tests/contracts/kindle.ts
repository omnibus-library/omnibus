import { type ExpectMutationOptions, post } from "../utils/api";

/** The send-to-Kindle endpoints: enqueue a delivery, then poll its status. */
export const kindleUrls = {
  send: /\/api\/kindle\/send(?:\?|$)/,
  sendStatus: /\/api\/kindle\/send\/status(?:\?|$)/,
};

/** The write a Send to Kindle action makes. */
export const kindle = {
  send: (bookUuid: string): ExpectMutationOptions =>
    post(kindleUrls.send, { book_uuid: bookUuid, file_id: null }),
};

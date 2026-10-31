import type { ReadStatus } from "../data/readStatus";
import type { ExpectMutationOptions } from "../utils/api";

/** The read-status endpoint the readers put to. */
export const readStatusUrls = {
  set: /\/api\/read-status(?:\?|$)/,
};

/** The read-status writes a reader makes by itself. */
export const readStatus = {
  /** The write a reader or the book page's control makes; no arguments pins no body. */
  set: (bookUuid?: string, status?: ReadStatus): ExpectMutationOptions => ({
    method: "PUT",
    url: readStatusUrls.set,
    expectedBody:
      bookUuid && status ? { book_uuid: bookUuid, status } : undefined,
    expectedStatus: 200,
  }),

  /** The write an open makes, once the page load and its fetches settle. */
  setOnOpen: (bookUuid: string, status: ReadStatus): ExpectMutationOptions => ({
    ...readStatus.set(bookUuid, status),
    timeout: 20_000,
  }),
};

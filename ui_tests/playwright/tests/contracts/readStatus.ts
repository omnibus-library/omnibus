import type { ReadStatus } from "../data/readStatus";
import type { ExpectMutationOptions } from "../utils/api";

/** The read-status endpoint the readers post to. */
export const readStatusUrls = {
  set: /\/api\/rpc\/read-status\/set(?:\?|$)/,
};

/** The read-status writes a reader makes by itself. */
export const readStatus = {
  /** The write a reader makes on reaching the end of an unfinished book. */
  set: (bookUuid: string, status: ReadStatus): ExpectMutationOptions => ({
    method: "POST",
    url: readStatusUrls.set,
    expectedBody: { update: { book_uuid: bookUuid, status } },
    expectedStatus: 200,
  }),

  /** The write an open makes, once the page load and its fetches settle. */
  setOnOpen: (bookUuid: string, status: ReadStatus): ExpectMutationOptions => ({
    ...readStatus.set(bookUuid, status),
    timeout: 20_000,
  }),

  // batch-H:
  /** The write the book page's control makes; no body is pinned. */
  change: (): ExpectMutationOptions => ({
    method: "POST",
    url: readStatusUrls.set,
    expectedStatus: 200,
  }),
};

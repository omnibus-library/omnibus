import type { ReadStatus } from "../data/readStatus";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The read-status endpoint the readers post to. */
export const readStatusUrls = {
  set: /\/api\/rpc\/read-status\/set(?:\?|$)/,
};

/** The read-status writes a reader makes by itself. */
export const readStatus = {
  /** The write a reader or the book page's control makes; no arguments pins no body. */
  set: (bookUuid?: string, status?: ReadStatus): ExpectMutationOptions =>
    post(
      readStatusUrls.set,
      bookUuid && status
        ? { update: { book_uuid: bookUuid, status } }
        : undefined,
    ),

  /** The write an open makes, once the page load and its fetches settle. */
  setOnOpen: (bookUuid: string, status: ReadStatus): ExpectMutationOptions => ({
    ...readStatus.set(bookUuid, status),
    timeout: 20_000,
  }),
};

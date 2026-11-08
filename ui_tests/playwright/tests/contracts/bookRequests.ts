import { expect } from "../fixtures/test";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The book-request endpoints a spec drives; the poll that follows a start is a GET. */
export const bookRequestUrls = {
  start: /\/api\/books\/[^/]+\/requests$/,
  choose: /\/api\/requests\/\d+\/choose$/,
  cancel: /\/api\/requests\/\d+\/cancel$/,
};

/** The request each book-request action must send, for `expectMutation`. */
export const bookRequests = {
  /** A start for `kind` answers 201 for a new request. */
  start: (kind: "ebook" | "audiobook" = "ebook"): ExpectMutationOptions =>
    post(bookRequestUrls.start, { kind }, 201),

  choose: (): ExpectMutationOptions =>
    post(bookRequestUrls.choose, {
      result_id: expect.any(Number),
    }),

  cancel: (): ExpectMutationOptions => post(bookRequestUrls.cancel),
};

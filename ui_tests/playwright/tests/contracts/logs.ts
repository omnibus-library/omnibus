import type { LogQuery } from "../data/logs";
import { expect } from "../fixtures/test";
import type { ExpectMutationOptions } from "../utils/api";

/** The endpoint the log viewer reads its pages from. */
export const logsUrls = {
  read: /\/api\/rpc\/logs(?:\?|$)/,
};

/** The reads the log viewer makes, which POST because they carry a query. */
export const logs = {
  /** A read whose query carries at least the fields in `query`. */
  read: (query?: LogQuery): ExpectMutationOptions => ({
    method: "POST",
    url: logsUrls.read,
    expectedBody:
      query === undefined
        ? undefined
        : expect.objectContaining({ query: expect.objectContaining(query) }),
    expectedStatus: 200,
  }),
};

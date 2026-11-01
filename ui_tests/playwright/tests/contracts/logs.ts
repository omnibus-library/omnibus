import type { LogQuery } from "../data/logs";
import type { ExpectMutationOptions } from "../utils/api";

/** The endpoint the log viewer reads its pages from. */
export const logsUrls = {
  read: /\/api\/admin\/logs(?:\?|$)/,
};

/** A lookahead for `key=value` anywhere in the query string. */
const param = ([key, value]: [string, unknown]) =>
  `(?=.*[?&]${key}=${encodeURIComponent(String(value))}(?:&|$))`;

/** The reads the log viewer makes, each carrying its filters in the query string. */
export const logs = {
  /** A read whose query carries at least the fields in `query`. */
  read: (query: LogQuery = {}): ExpectMutationOptions => ({
    method: "GET",
    url: new RegExp(
      `/api/admin/logs(?=\\?)${Object.entries(query).map(param).join("")}`,
    ),
    expectedStatus: 200,
  }),
};

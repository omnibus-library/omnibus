import type { StatsRange } from "../data/stats";
import type { ExpectMutationOptions } from "../utils/api";

/** The server functions the stats page reads through; each URL excludes its siblings. */
export const statsUrls = {
  summary: /\/api\/rpc\/stats(?:\?|$)/,
  librarySize: /\/api\/rpc\/library-size(?:\?|$)/,
  libraryComposition: /\/api\/rpc\/library-composition(?:\?|$)/,
  householdReaders: /\/api\/rpc\/household-readers(?:\?|$)/,
};

function read(url: RegExp, expectedBody?: unknown): ExpectMutationOptions {
  return { method: "POST", url, expectedBody, expectedStatus: 200 };
}

/** The reads the stats page makes, which are POSTs because they are server functions. */
export const stats = {
  /**
   * The summary a period pill fetches. The suite pins `timezoneId` to UTC, so
   * the offset is 0 (rule 10); `reader` is null on your own page, which Dioxus
   * encodes as an omitted argument.
   */
  summary: (range: StatsRange, reader: number | null = null) =>
    read(statsUrls.summary, { range, utc_offset_minutes: 0, user_id: reader }),

  householdReaders: () => read(statsUrls.householdReaders),
};

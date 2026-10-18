import type { StatsRange } from "../data/stats";
import { post } from "../utils/api";

/** The server functions the stats page reads through; each URL excludes its siblings. */
export const statsUrls = {
  summary: /\/api\/rpc\/stats(?:\?|$)/,
  librarySize: /\/api\/rpc\/library-size(?:\?|$)/,
  libraryComposition: /\/api\/rpc\/library-composition(?:\?|$)/,
  householdReaders: /\/api\/rpc\/household-readers(?:\?|$)/,
};

/** The reads the stats page makes, which are POSTs because they are server functions. */
export const stats = {
  /**
   * The summary a period pill fetches. The suite pins `timezoneId` to UTC, so
   * the offset is 0 (rule 10); `reader` is null on your own page, and Dioxus
   * sends that omitted argument as `user_id: null`.
   */
  summary: (range: StatsRange, reader: number | null = null) =>
    post(statsUrls.summary, { range, utc_offset_minutes: 0, user_id: reader }),

  householdReaders: () => post(statsUrls.householdReaders),
};

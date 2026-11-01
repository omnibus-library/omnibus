import type { StatsRange } from "../data/stats";
import type { ForcedRequest } from "../utils/api";

/** The REST reads the stats page makes; each URL excludes its siblings. */
export const statsUrls = {
  summary: /\/api\/stats(?:\?|$)/,
  librarySize: /\/api\/library-size(?:\?|$)/,
  libraryComposition: /\/api\/library-composition(?:\?|$)/,
  householdReaders: /\/api\/users(?:\?|$)/,
};

/** The reads the stats page makes, all GETs. */
export const stats = {
  /**
   * The summary query a period pill fetches. The suite pins `timezoneId` to
   * UTC, so the offset is 0 (rule 10); `user_id` is left off on your own page.
   */
  summary: (
    range: StatsRange,
    reader: number | null = null,
  ): Record<string, string> => ({
    range,
    utc_offset_minutes: "0",
    ...(reader === null ? {} : { user_id: String(reader) }),
  }),

  householdReaders: (): ForcedRequest => ({
    method: "GET",
    url: statsUrls.householdReaders,
  }),
};

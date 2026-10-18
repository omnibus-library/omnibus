import type { ExpectMutationOptions } from "../utils/api";

/** The account endpoints the Settings → Account switches post to. */
export const accountUrls = {
  scrollStops: /\/api\/rpc\/account\/book-detail-scroll-stops(?:\?|$)/,
  shareStats: /\/api\/rpc\/account\/share-stats(?:\?|$)/,
  stackSeries: /\/api\/rpc\/account\/stack-series(?:\?|$)/,
};

function switchWrite(url: RegExp, enabled?: boolean): ExpectMutationOptions {
  return {
    method: "POST",
    url,
    expectedBody: enabled === undefined ? undefined : { enabled },
    expectedStatus: 200,
  };
}

/** The writes a reader makes by flipping a per-user switch. */
export const account = {
  scrollStops: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.scrollStops, enabled),

  shareStats: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.shareStats, enabled),

  stackSeries: (enabled?: boolean): ExpectMutationOptions =>
    switchWrite(accountUrls.stackSeries, enabled),
};

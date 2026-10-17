import type { ExpectMutationOptions } from "../utils/api";

/** The account endpoint a settings page posts to. */
export const accountUrls = {
  scrollStops: /\/api\/rpc\/account\/book-detail-scroll-stops$/,
};

/** The writes a reader makes on their own account preferences. */
export const account = {
  setScrollStops: (enabled: boolean): ExpectMutationOptions => ({
    method: "POST",
    url: accountUrls.scrollStops,
    expectedBody: { enabled },
    expectedStatus: 200,
  }),
};

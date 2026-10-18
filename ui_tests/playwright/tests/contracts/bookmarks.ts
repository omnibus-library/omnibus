import type { NewBookmark } from "../data/bookmarks";
import type { ExpectMutationOptions } from "../utils/api";

/** The bookmark endpoints the readers post to. */
export const bookmarksUrls = {
  create: /\/api\/rpc\/bookmarks\/create(?:\?|$)/,
};

/** The writes the bookmarks drawer makes. */
export const bookmarks = {
  /** The save "+ Bookmark" makes. */
  create: (bookmark: NewBookmark): ExpectMutationOptions => ({
    method: "POST",
    url: bookmarksUrls.create,
    expectedBody: { input: { client_id: null, ...bookmark } },
    expectedStatus: 200,
  }),

  /** The save "+ Bookmark" makes at the playhead, whose position the body leaves unpinned. */
  createAtPlayhead: (): ExpectMutationOptions => ({
    method: "POST",
    url: bookmarksUrls.create,
    expectedStatus: 200,
  }),
};

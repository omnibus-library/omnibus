import type { NewBookmark } from "../data/bookmarks";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The bookmark endpoints the readers post to. */
export const bookmarksUrls = {
  create: /\/api\/rpc\/bookmarks\/create(?:\?|$)/,
};

/** The writes the bookmarks drawer makes. */
export const bookmarks = {
  /** The save "+ Bookmark" makes. Pass no bookmark for one taken at the playhead, whose position a test cannot pin. */
  create: (bookmark?: NewBookmark): ExpectMutationOptions =>
    post(
      bookmarksUrls.create,
      bookmark && { input: { client_id: null, ...bookmark } },
    ),
};

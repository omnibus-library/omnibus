import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoint behind the suggestions strip. */
export const suggestionsUrls = {
  fetch: /\/api\/rpc\/ebook-suggestions(?:\?|$)/,
};

/** The strip's own fetch. */
export const suggestions = {
  /** A POST from the page's mount effect, so it waits out hydration. */
  fetch: (): ExpectMutationOptions => ({
    ...post(suggestionsUrls.fetch),
    timeout: 30_000,
  }),
};

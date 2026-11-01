import { type ExpectMutationOptions, post } from "../utils/api";

/** Fetch metadata's endpoints: a GET, and two reads that POST. */
export const metadataUrls = {
  providers: /\/api\/metadata\/providers(?:\?|$)/,
  search: /\/api\/metadata\/editions\/search(?:\?|$)/,
  hydrate: /\/api\/metadata\/editions\/hydrate(?:\?|$)/,
};

/** Fetch metadata's reads, which POST but change nothing. */
export const metadata = {
  search: (): ExpectMutationOptions => post(metadataUrls.search),
};

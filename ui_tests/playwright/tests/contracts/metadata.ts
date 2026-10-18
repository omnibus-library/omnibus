import { type ExpectMutationOptions, post } from "../utils/api";

/** The edition picker's endpoints: a GET, and two reads that POST. */
export const metadataUrls = {
  providers: /\/api\/rpc\/metadata\/providers(?:\?|$)/,
  search: /\/api\/rpc\/metadata\/editions\/search(?:\?|$)/,
  hydrate: /\/api\/rpc\/metadata\/editions\/hydrate(?:\?|$)/,
};

/** The edition picker's reads, which POST but change nothing. */
export const metadata = {
  search: (): ExpectMutationOptions => post(metadataUrls.search),
};

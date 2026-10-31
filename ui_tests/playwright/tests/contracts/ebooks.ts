import type { Request } from "@playwright/test";
import type { ExpectMutationOptions } from "../utils/api";

/** The library listing endpoint the landing page reads. */
export const ebooksUrls = {
  page: /\/api\/ebooks(?:\?|$)/,
};

/** The filter clauses a list read carries in its `filter` param; none when it has none. */
export function filterClauses(request: Request): unknown[] {
  const filter = new URL(request.url()).searchParams.get("filter");
  return filter ? JSON.parse(filter) : [];
}

/** The landing page's keyset page read. */
export const ebooks = {
  /** A read a full page load triggers passes a longer `timeout`. */
  page: (timeout?: number): ExpectMutationOptions => ({
    method: "GET",
    url: ebooksUrls.page,
    expectedStatus: 200,
    timeout,
  }),
};

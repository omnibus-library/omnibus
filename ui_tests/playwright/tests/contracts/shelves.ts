import type { Request } from "@playwright/test";
import {
  type ExpectMutationOptions,
  type ForcedRequest,
  post,
} from "../utils/api";

/** The shelf endpoints the library and shelf pages call. */
export const shelvesUrls = {
  list: /\/api\/rpc\/shelves(?:\?|$)/,
  create: /\/api\/rpc\/shelves\/create(?:\?|$)/,
  update: /\/api\/rpc\/shelves\/update(?:\?|$)/,
  delete: /\/api\/rpc\/shelves\/delete(?:\?|$)/,
  addBooks: /\/api\/shelves\/\d+\/books(?:\?|$)/,
  removeBook: /\/api\/shelves\/\d+\/books\/[^/?]+(?:\?|$)/,
  page: /\/api\/rpc\/shelves\/page(?:\?|$)/,
};

/** How many filter clauses a shelf member read carries. */
export function clauseCount(request: Request): number {
  return request.postDataJSON().filters.clauses.length;
}

/** A member read that carries a filter. */
export const filteredShelfRead = (request: Request): boolean =>
  clauseCount(request) > 0;

/** A member read that carries none, the full list. */
export const unfilteredShelfRead = (request: Request): boolean =>
  clauseCount(request) === 0;

/** An omitted argument leaves the body unchecked. */
export const shelves = {
  create: (req?: unknown): ExpectMutationOptions =>
    post(shelvesUrls.create, req && { req }),

  update: (id?: number, req?: unknown): ExpectMutationOptions =>
    post(shelvesUrls.update, req && { id, req }),

  delete: (id?: number): ExpectMutationOptions =>
    post(shelvesUrls.delete, id === undefined ? undefined : { id }),

  addBooks: (id?: number, bookUuids?: string[]): ExpectMutationOptions =>
    post(
      id === undefined
        ? shelvesUrls.addBooks
        : new RegExp(`/api/shelves/${id}/books(?:\\?|$)`),
      bookUuids && { book_uuids: bookUuids },
      204,
    ),

  removeBook: (id?: number, bookUuid?: string): ExpectMutationOptions => ({
    method: "DELETE",
    url:
      id === undefined || bookUuid === undefined
        ? shelvesUrls.removeBook
        : new RegExp(`/api/shelves/${id}/books/${bookUuid}(?:\\?|$)`),
    expectedStatus: 204,
  }),

  /** The shelf list read behind the `/shelves` index. */
  list: (): ForcedRequest => ({ method: "GET", url: shelvesUrls.list }),

  /** A shelf's member read, a POST that changes nothing. */
  page: (): ExpectMutationOptions => post(shelvesUrls.page),
};

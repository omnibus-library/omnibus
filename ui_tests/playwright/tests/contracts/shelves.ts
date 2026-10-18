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
  addBooks: /\/api\/rpc\/shelves\/add-books(?:\?|$)/,
  removeBook: /\/api\/rpc\/shelves\/remove-book(?:\?|$)/,
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

/** Each omitted argument leaves the body unchecked, as the originals did. */
export const shelves = {
  create: (req?: unknown): ExpectMutationOptions =>
    post(shelvesUrls.create, req && { req }),

  update: (id?: number, req?: unknown): ExpectMutationOptions =>
    post(shelvesUrls.update, req && { id, req }),

  delete: (id?: number): ExpectMutationOptions =>
    post(shelvesUrls.delete, id === undefined ? undefined : { id }),

  addBooks: (id?: number, bookUuids?: string[]): ExpectMutationOptions =>
    post(shelvesUrls.addBooks, bookUuids && { id, book_uuids: bookUuids }),

  removeBook: (id?: number, bookUuid?: string): ExpectMutationOptions =>
    post(shelvesUrls.removeBook, bookUuid && { id, book_uuid: bookUuid }),

  /** The shelf list read behind the `/shelves` index. */
  list: (): ForcedRequest => ({ method: "GET", url: shelvesUrls.list }),

  /** A shelf's member read, a POST that changes nothing. */
  page: (): ExpectMutationOptions => post(shelvesUrls.page),
};

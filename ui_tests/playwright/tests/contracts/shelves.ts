import type { Request } from "@playwright/test";
import type { ExpectMutationOptions } from "../utils/api";

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

function shelfWrite(
  url: RegExp,
  expectedBody?: unknown,
): ExpectMutationOptions {
  return { method: "POST", url, expectedBody, expectedStatus: 200 };
}

/** Each omitted argument leaves the body unchecked, as the originals did. */
export const shelves = {
  create: (req?: unknown): ExpectMutationOptions =>
    shelfWrite(shelvesUrls.create, req && { req }),

  update: (id?: number, req?: unknown): ExpectMutationOptions =>
    shelfWrite(shelvesUrls.update, req && { id, req }),

  delete: (id?: number): ExpectMutationOptions =>
    shelfWrite(shelvesUrls.delete, id === undefined ? undefined : { id }),

  addBooks: (id?: number, bookUuids?: string[]): ExpectMutationOptions =>
    shelfWrite(
      shelvesUrls.addBooks,
      bookUuids && { id, book_uuids: bookUuids },
    ),

  removeBook: (id?: number, bookUuid?: string): ExpectMutationOptions =>
    shelfWrite(shelvesUrls.removeBook, bookUuid && { id, book_uuid: bookUuid }),

  /** A shelf's member read, a POST that changes nothing. */
  page: (): ExpectMutationOptions => shelfWrite(shelvesUrls.page),
};

import type { Request } from "@playwright/test";
import type { NewShelf, ShelfUpdate } from "../data/shelves";
import type {
  ExpectMutationOptions,
  ForcedRequest,
  MutationMethod,
} from "../utils/api";

const ID = String.raw`\d+`;
const END = String.raw`(?:\?|$)`;

/** `/api/shelves/{id}…`, for one shelf when `id` is given, else any. */
const shelfUrl = (id: number | undefined, rest = ""): RegExp =>
  new RegExp(String.raw`\/api\/shelves\/${id ?? ID}${rest}${END}`);

/** The shelf endpoints the library and shelf pages call. */
export const shelvesUrls = {
  list: new RegExp(String.raw`\/api\/shelves${END}`),
  shelf: shelfUrl(undefined),
  books: shelfUrl(undefined, String.raw`\/books`),
  book: shelfUrl(undefined, String.raw`\/books\/[^/?]+`),
  page: shelfUrl(undefined, String.raw`\/page`),
};

/** How many filter clauses a shelf member read carries, from its `filter` query. */
export function clauseCount(request: Request): number {
  const filter = new URL(request.url()).searchParams.get("filter");
  return filter ? (JSON.parse(filter) as unknown[]).length : 0;
}

/** A member read that carries a filter. */
export const filteredShelfRead = (request: Request): boolean =>
  clauseCount(request) > 0;

/** A member read that carries none, the full list. */
export const unfilteredShelfRead = (request: Request): boolean =>
  clauseCount(request) === 0;

const call = (
  method: MutationMethod | "GET",
  url: RegExp,
  expectedStatus: number,
  expectedBody?: unknown,
): ExpectMutationOptions => ({ method, url, expectedBody, expectedStatus });

/** An omitted argument leaves the body (and the shelf id) unchecked. */
export const shelves = {
  create: (req?: Partial<NewShelf>): ExpectMutationOptions =>
    call("POST", shelvesUrls.list, 201, req),

  update: (id?: number, req?: ShelfUpdate): ExpectMutationOptions =>
    call("PATCH", shelfUrl(id), 200, req),

  delete: (id?: number): ExpectMutationOptions =>
    call("DELETE", shelfUrl(id), 204),

  addBooks: (id?: number, bookUuids?: string[]): ExpectMutationOptions =>
    call(
      "POST",
      shelfUrl(id, String.raw`\/books`),
      204,
      bookUuids && { book_uuids: bookUuids },
    ),

  removeBook: (id?: number, bookUuid?: string): ExpectMutationOptions =>
    call(
      "DELETE",
      shelfUrl(id, String.raw`\/books\/${bookUuid ?? "[^/?]+"}`),
      204,
    ),

  /** The shelf list read behind the `/shelves` index. */
  list: (): ForcedRequest => ({ method: "GET", url: shelvesUrls.list }),

  /** A shelf's member read, which a sort or filter change refetches. */
  page: (): ExpectMutationOptions => call("GET", shelvesUrls.page, 200),
};

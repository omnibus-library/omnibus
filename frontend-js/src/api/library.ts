import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { Book } from "./books";
import { toBook } from "./books";
import type { BookUuid } from "./core";
import { failure, ok, send } from "./core";
import {
  getAuthors,
  getEbooks,
  getGenres,
  getPostBulkOverridesUrl,
  getTags,
  listSeries,
} from "./generated/omnibus";
import type {
  BulkMetadataEdit,
  EbookPage,
  SeriesStack as SeriesStackWire,
} from "./generated/schemas";
import { SortDir, SortKey } from "./generated/schemas";

export { SortDir, SortKey };

export const FilterClauseSchema = z.object({
  field: z.enum(["tag", "genre", "author", "series", "format", "shelf"]),
  mode: z.enum(["include", "exclude"]),
  values: z.array(z.string()),
});
export type FilterClause = z.infer<typeof FilterClauseSchema>;
export type FilterField = FilterClause["field"];
export type FilterMode = FilterClause["mode"];

/** What the reader has done with one volume of a stack. */
export type StackState = {
  uuid: string;
  started: boolean;
  finished: boolean;
  percent: number | null;
};

/** A series folded into one cell of a book list, standing in its lead's slot. */
export type SeriesStack = {
  leadUuid: string;
  name: string;
  seriesId: number | null;
  /** Every volume that passes the request's filters, in series order. */
  members: Book[];
  states: StackState[];
};

function toStack(wire: SeriesStackWire): SeriesStack {
  return {
    leadUuid: wire.lead_uuid,
    name: wire.name,
    seriesId: wire.series_id ?? null,
    members: wire.members.map(toBook),
    states: (wire.states ?? []).map((s) => ({
      uuid: s.uuid,
      started: s.started ?? false,
      finished: s.finished ?? false,
      percent: s.percent ?? null,
    })),
  };
}

export type BookPage = {
  books: Book[];
  stacks: SeriesStack[];
  total: number;
  next: string | null;
  hidden: number | null;
  path: string | null;
};

const countHeader = z.coerce.number().int().nonnegative();

/** The screen's shape of one page of `GET /api/ebooks`, whose paging is in headers. */
export function toBookPage(page: EbookPage, headers: Headers): BookPage {
  const books = page.books.map(toBook);
  const hidden = headers.get("X-Hidden-Count");
  return {
    books,
    stacks: (page.stacks ?? []).map(toStack),
    total: countHeader.parse(headers.get("X-Total-Count") ?? books.length),
    next: headers.get("X-Next-Cursor"),
    hidden: hidden === null ? null : countHeader.parse(hidden),
    path: page.path ?? null,
  };
}

/**
 * The `filter` query value: the clauses as JSON, in the key order the server's
 * own encoding uses, or `undefined` when there are none.
 */
export const filterParam = (clauses: FilterClause[]) =>
  clauses.length
    ? JSON.stringify(
        clauses.map(({ field, mode, values }) => ({ field, mode, values })),
      )
    : undefined;

/** What a library page is fetched under; a change to any of it restarts at page 1. */
export type LibraryQuery = {
  sort: SortKey;
  dir: SortDir;
  clauses: FilterClause[];
  /** The formats the reader hides from All Books, sorted. */
  excludeFormats: string[];
  /** Fold each series into one stack; the shelf lens never sends it. */
  stackSeries: boolean;
};

export const PAGE_SIZE = 100;

/** One page of the library in `query`'s order; pass `""` for the first page. */
export async function fetchBookPage(
  query: LibraryQuery,
  cursor: string,
): Promise<BookPage> {
  // The API refuses a cursor unless sort and dir are both explicit.
  const filter = filterParam(query.clauses);
  const res = await getEbooks({
    sort: query.sort,
    dir: query.dir,
    limit: PAGE_SIZE,
    omit_description: true,
    ...(cursor ? { cursor } : {}),
    ...(filter ? { filter } : {}),
    ...(query.stackSeries ? { stack_series: true } : {}),
    ...(query.excludeFormats.length
      ? { exclude_formats: query.excludeFormats.join(",") }
      : {}),
  });
  if (res.status !== 200) throw failure(res);
  return toBookPage(res.data, res.headers);
}

/** Applies one edit to every book in a single request; the server merges tag and genre changes into each book's own lists. */
export async function bulkSaveOverrides(
  uuids: BookUuid[],
  edit: BulkMetadataEdit,
): Promise<void> {
  await send(getPostBulkOverridesUrl(), "POST", { uuids, edit });
}

/** A name and the number of books that carry it. */
export type NamedCount = { name: string; count: number };

const NAME_COUNTS = {
  // Tags and genres are the most-used 500 at most.
  tag: async () => ok(await getTags()),
  genre: async () => ok(await getGenres()),
  author: async () =>
    ok(await getAuthors()).map((a) => ({ name: a.name, count: a.book_count })),
  series: async () =>
    ok(await listSeries()).map((s) => ({ name: s.name, count: s.book_count })),
};

export type NameCountField = keyof typeof NAME_COUNTS;

/** Every value of a name field with its book count; the filter menus and the bulk editor's suggestions share it. */
export const nameCountsQuery = (field: NameCountField) =>
  queryOptions({
    queryKey: ["name-counts", field],
    queryFn: NAME_COUNTS[field] as () => Promise<NamedCount[]>,
  });

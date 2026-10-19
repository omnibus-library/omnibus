import { type ExpectedBook, FIXTURE_BOOKS } from "../fixtures/epubs";
import type { ShelfRef } from "./shelves";

export const FILTER_FIELDS = [
  "shelf",
  "tag",
  "genre",
  "author",
  "series",
  "format",
] as const;

export type FilterField = (typeof FILTER_FIELDS)[number];
export type FilterMode = "include" | "exclude";

/** One value to tick in the picker; `search` narrows its list until it shows. */
export type FilterPick = { label: string; search?: string };

/** One clause of the library filter, as its field's facet builds it. */
export type FilterClause = {
  field: FilterField;
  mode: FilterMode;
  picks: FilterPick[];
};

/** Authors the filter specs narrow by; no audiobook fixture may share one. */
export const FILTERED_AUTHORS = [
  "Alfred Aho",
  "Jeffrey Ullman",
  "Monica Lam",
  "Ravi Sethi",
  "H. G. Wells",
];

/** The three Compiler Compendium EPUBs and the Wells PDF, kept on one shelf. */
export const FILTER_SHELF_SLUGS = [
  "compiler-compendium-1",
  "compiler-compendium-2",
  "compiler-compendium-3",
  "time-machine",
];

/** The reader's hand-picked shelf of `FILTER_SHELF_SLUGS`. */
export type FilterShelf = ShelfRef & {
  memberUuid: (slug: string) => string;
};

export const clauses = {
  includePdf: {
    field: "format",
    mode: "include",
    picks: [{ label: "PDF" }],
  },
  includeEpub: {
    field: "format",
    mode: "include",
    picks: [{ label: "EPUB" }],
  },
  includeCompendium: {
    field: "series",
    mode: "include",
    picks: [{ label: "Compiler Compendium", search: "Compendium" }],
  },
  includeAho: {
    field: "author",
    mode: "include",
    picks: [{ label: "Alfred Aho", search: "Aho" }],
  },
  includeLam: {
    field: "author",
    mode: "include",
    picks: [{ label: "Monica Lam", search: "Lam" }],
  },
  excludeUllman: {
    field: "author",
    mode: "exclude",
    picks: [{ label: "Jeffrey Ullman", search: "Ullman" }],
  },
  excludeSethi: {
    field: "author",
    mode: "exclude",
    picks: [{ label: "Ravi Sethi", search: "Sethi" }],
  },
  excludeWells: {
    field: "author",
    mode: "exclude",
    picks: [{ label: "H. G. Wells", search: "Wells" }],
  },
} satisfies Record<string, FilterClause>;

/** The fixture with this slug; the tile and row test ids are cut from it. */
export function bookBySlug(slug: string): ExpectedBook {
  const book = FIXTURE_BOOKS.find((b) => b.slug === slug);
  if (!book) throw new Error(`no fixture ${slug}`);
  return book;
}

/** The slugs of the fixtures `matches` selects, sorted as the grid reads. */
export function slugsWhere(matches: (book: ExpectedBook) => boolean): string[] {
  return FIXTURE_BOOKS.filter(matches)
    .map((book) => book.slug)
    .sort();
}

/** The titles of the fixtures with these slugs, sorted as a shelf reads. */
export function titlesOf(slugs: string[]): string[] {
  return slugs.map((slug) => bookBySlug(slug).title).sort();
}

export function hasFormat(book: ExpectedBook, extension: string): boolean {
  return book.filename.toLowerCase().endsWith(`.${extension}`);
}

export function authoredBy(book: ExpectedBook, ...authors: string[]): boolean {
  return book.authors.some((author) => authors.includes(author));
}

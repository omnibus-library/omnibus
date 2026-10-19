import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { type BookUuid, failure, requireUuid } from "../api";
import {
  deleteEbookCover,
  deleteEbookOverrides,
  getEbookByUuid,
  listMetadataProviders,
  postEbookCover,
  postEbookCoverFromUrl,
  postEbookOverrides,
  postEditionSearch,
} from "./generated/omnibus";
import type {
  EbookMetadata,
  EditionSearchRequest,
  EditionSearchResponse,
  MetadataOverrides,
  MetadataProvider,
  ProviderEdition,
} from "./generated/schemas";

// The metadata edit page's reads and writes. It imports `../api` only inside
// function bodies: `api.ts` re-exports this module.

/** What the edit form holds: every field as the text or list the reader edits. */
export const MetaFormSchema = z.object({
  title: z.string(),
  description: z.string(),
  publisher: z.string(),
  published: z.string(),
  language: z.string(),
  series: z.string(),
  seriesIndex: z.string(),
  isbn13: z.string(),
  isbn10: z.string(),
  printPages: z
    .string()
    .refine(
      (v) => /^\d*$/.test(v.trim()),
      "Print page count must be a whole number.",
    ),
  authors: z.array(z.string()),
  tags: z.array(z.string()),
  genres: z.array(z.string()),
});
export type MetaForm = z.infer<typeof MetaFormSchema>;

/** The form's starting values for a book: a missing field is blank. */
export function formFromBook(wire: EbookMetadata): MetaForm {
  return {
    title: wire.title ?? "",
    description: wire.description ?? "",
    publisher: wire.publisher ?? "",
    published: wire.published ?? "",
    language: wire.language ?? "",
    series: wire.series ?? "",
    seriesIndex: wire.series_index ?? "",
    isbn13: wire.isbn13 ?? "",
    isbn10: wire.isbn10 ?? "",
    printPages: wire.print_pages?.toString() ?? "",
    authors: wire.creators.map((c) => c.name),
    tags: wire.subjects,
    genres: wire.genres ?? [],
  };
}

const TEXT_FIELDS = {
  title: "title",
  description: "description",
  publisher: "publisher",
  published: "published",
  language: "language",
  series: "series",
  seriesIndex: "series_index",
  isbn13: "isbn13",
  isbn10: "isbn10",
} as const;

/** Whether two lists hold the same values in the same order. */
export const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Only the fields that differ from `baseline`; a blank `printPages` is left out, so it keeps the override. */
export function overridesFrom(
  baseline: MetaForm,
  values: MetaForm,
): MetadataOverrides {
  const edit: MetadataOverrides = {};
  for (const [field, wire] of Object.entries(TEXT_FIELDS) as [
    keyof typeof TEXT_FIELDS,
    (typeof TEXT_FIELDS)[keyof typeof TEXT_FIELDS],
  ][]) {
    if (values[field] !== baseline[field]) edit[wire] = values[field];
  }
  const pages = values.printPages.trim();
  if (pages && Number(pages) !== Number(baseline.printPages || Number.NaN)) {
    edit.print_pages = Number(pages);
  }
  if (!sameList(values.authors, baseline.authors)) {
    edit.creators = values.authors.map((name) => ({ name, role: "aut" }));
  }
  if (!sameList(values.tags, baseline.tags)) edit.subjects = values.tags;
  if (!sameList(values.genres, baseline.genres)) edit.genres = values.genres;
  return edit;
}

/** The edit page's shape of `GET /api/ebooks/{uuid}`. */
export function toEditableBook(wire: EbookMetadata) {
  const first = wire.creators[0];
  return {
    uuid: requireUuid(wire.unique_identifier, wire.id),
    displayTitle: wire.title?.trim() ? wire.title : wire.filename,
    primaryAuthor: first ? { name: first.name, id: first.id ?? null } : null,
    accent: wire.accent ?? null,
    filename: wire.filename,
    sortBy: first ? (first.file_as ?? first.name) : "",
    identifiers: wire.identifiers,
    hasOverride: wire.has_override ?? false,
    hasCoverOverride: wire.has_cover_override ?? false,
    coverUrl: wire.cover_url ?? null,
    form: formFromBook(wire),
  };
}

export type EditableBook = ReturnType<typeof toEditableBook>;

/** The book for the edit page, or `null` when no book has that uuid. */
export async function fetchEditableBook(
  uuid: BookUuid,
): Promise<EditableBook | null> {
  const res = await getEbookByUuid(encodeURIComponent(uuid));
  if (res.status === 404) return null;
  if (res.status !== 200) throw failure(res);
  return toEditableBook(res.data);
}

/** A fresh read per visit: the form seeds from it once, so a cached copy would seed it stale. */
export const editableBookQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "edit"],
    queryFn: () => fetchEditableBook(uuid),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });

/** Writes the edit over the book's scanned values; an empty edit sends nothing. */
export async function saveOverrides(
  uuid: BookUuid,
  edit: MetadataOverrides,
): Promise<void> {
  if (Object.keys(edit).length === 0) return;
  const res = await postEbookOverrides(uuid, edit);
  if (res.status !== 200) throw failure(res);
}

/** Drops every edit to the book, its cover included. */
export async function revertOverrides(uuid: BookUuid): Promise<void> {
  const res = await deleteEbookOverrides(uuid);
  if (res.status !== 200) throw failure(res);
}

/** Replaces the book's cover with an image the reader picked; answers with the book as it now reads. */
export async function uploadCover(
  uuid: BookUuid,
  cover: File,
): Promise<EditableBook> {
  const res = await postEbookCover(uuid, { cover });
  if (res.status !== 200) throw failure(res);
  return toEditableBook(res.data);
}

/** Has the server fetch `url` as the book's cover; answers with the book as it now reads. */
export async function coverFromUrl(
  uuid: BookUuid,
  url: string,
): Promise<EditableBook> {
  const res = await postEbookCoverFromUrl(uuid, { url });
  if (res.status !== 200) throw failure(res);
  return toEditableBook(res.data);
}

/** Puts the scanned cover back; answers with the book as it now reads. */
export async function revertCover(uuid: BookUuid): Promise<EditableBook> {
  const res = await deleteEbookCover(uuid);
  if (res.status !== 200) throw failure(res);
  return toEditableBook(res.data);
}

/** The metadata providers, by the name and the stable slug the UI shows them under. */
export const PROVIDERS = {
  open_library: { name: "Open Library", slug: "open-library" },
  google_books: { name: "Google Books", slug: "google-books" },
  hardcover: { name: "Hardcover", slug: "hardcover" },
} satisfies Record<MetadataProvider, { name: string; slug: string }>;

/** Whether at least one provider is set up to answer a search. */
export const hasProviderQuery = queryOptions({
  queryKey: ["metadata-providers"],
  queryFn: async () => {
    const res = await listMetadataProviders();
    if (res.status !== 200) throw failure(res);
    return res.data.some((p) => p.configured);
  },
});

/** The search the three fields describe, or `null` when all are blank; a blank field is left out. */
export function editionRequest(
  title: string,
  author: string,
  isbn: string,
): EditionSearchRequest | null {
  const [t, a, i] = [title, author, isbn].map((v) => v.trim() || undefined);
  if (!t && !a && !i) return null;
  // `query` is free text for clients with no picker; the provider asks read the fields.
  return {
    query: [t, a].filter(Boolean).join(" "),
    title: t,
    author: a,
    isbn: i,
  };
}

/** The editions each provider found for a search, and what each provider did. */
export async function searchEditions(
  req: EditionSearchRequest,
): Promise<EditionSearchResponse> {
  const res = await postEditionSearch(req);
  if (res.status !== 200) throw failure(res);
  return res.data;
}

const STOP_WORDS = new Set(
  "a an and by for from in of on or the to with".split(" "),
);

/** The query's words, lowercased and stripped of punctuation, minus stop words and initials. */
function queryWords(query: string): string[] {
  return query
    .split(/\s+/)
    .map((w) =>
      w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase(),
    )
    .filter((w) => [...w].length > 1 && !STOP_WORDS.has(w));
}

/**
 * The order the candidates read in, derived from the candidates alone so a slow
 * or missing provider moves nothing else: relevance (unscored last), whole query
 * covered by title and authors, shorter title, then title, ISBN, provider, ref.
 */
export function inStableOrder(
  editions: ProviderEdition[],
  query: string,
): ProviderEdition[] {
  const words = queryWords(query);
  const keyed = editions.map((e) => {
    const title = e.title.trim().toLowerCase();
    const hay = `${e.title} ${e.authors.join(" ")}`.toLowerCase();
    return {
      e,
      title,
      relevance: e.relevance ?? Number.NEGATIVE_INFINITY,
      // A blank query covers nothing, so it leaves the order to the later keys.
      partial: !(words.length > 0 && words.every((w) => hay.includes(w))),
    };
  });
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return keyed
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        Number(a.partial) - Number(b.partial) ||
        [...a.title].length - [...b.title].length ||
        text(a.title, b.title) ||
        text(a.e.isbn13 ?? "", b.e.isbn13 ?? "") ||
        text(PROVIDERS[a.e.source].slug, PROVIDERS[b.e.source].slug) ||
        text(a.e.provider_ref, b.e.provider_ref),
    )
    .map((k) => k.e);
}

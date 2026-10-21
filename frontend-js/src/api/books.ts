import { z } from "zod";
import type { AuthorId, BookUuid, SeriesId } from "./core";
import { failure, ok, requireUuid, send } from "./core";
import {
  getEbookByUuid,
  getPostEbookSummaryFetchUrl,
  getSearchPalette,
  getSuggestions,
  getSummarySources,
  postEbookOverrides,
} from "./generated/omnibus";
import type {
  BookSuggestion as BookSuggestionWire,
  EbookMetadata,
  PaletteResults as PaletteWire,
  SummarySource,
} from "./generated/schemas";

export function toBook(wire: EbookMetadata) {
  // An empty name is a cleared series, not a series called "".
  const series = wire.series?.trim()
    ? { name: wire.series, index: wire.series_index ?? null }
    : null;
  return {
    uuid: requireUuid(wire.unique_identifier, wire.id),
    title: wire.title?.trim() ? wire.title : wire.filename,
    authors: wire.creators.map((c) => c.name),
    series,
    accent: wire.accent ?? null,
    hasCover: wire.cover_url != null,
    subjects: wire.subjects,
    genres: wire.genres ?? [],
    formats: wire.formats ?? [],
    published: wire.published ?? null,
    language: wire.language ?? null,
    addedAt: wire.added_at ?? null,
    modified: wire.modified ?? null,
    hasPhysical: wire.has_physical ?? false,
    seriesId: wire.series_id == null ? null : (wire.series_id as SeriesId),
  };
}

export type Book = ReturnType<typeof toBook>;

const hasFormat = (formats: readonly string[], ...names: string[]) =>
  formats.some((f) => names.includes(f.toLowerCase()));

/** The screen's shape of `GET /api/ebooks/{uuid}`. */
export function toBookDetail(wire: EbookMetadata) {
  const formats = wire.formats ?? [];
  return {
    ...toBook(wire),
    description: wire.description ?? null,
    creators: wire.creators.map((c) => ({
      name: c.name,
      id: c.id == null ? null : (c.id as AuthorId),
    })),
    // M4A shares the M4B container and code path, so it counts as audio too.
    hasAudio: hasFormat(formats, "m4b", "m4a", "mp3"),
    hasEbook: hasFormat(formats, "epub"),
    hasComic: hasFormat(formats, "cbz"),
    hasPdf: hasFormat(formats, "pdf"),
    bookFiles: (wire.book_files ?? []).map((f) => ({
      id: f.id,
      format: f.format,
      label: f.label ?? null,
      ordinal: f.ordinal,
      sizeBytes: f.size_bytes ?? 0,
    })),
    epubSizeBytes: wire.epub_size_bytes ?? null,
    publisher: wire.publisher ?? null,
    identifiers: wire.identifiers.map((i) => ({
      scheme: i.scheme ?? null,
      value: i.value,
    })),
    isbn10: wire.isbn10 ?? null,
    isbn13: wire.isbn13 ?? null,
    pageCount: wire.page_count ?? null,
  };
}

export type BookDetail = ReturnType<typeof toBookDetail>;

/** The screen's shape of `GET /api/search/palette`: capped hits, true totals. */
export function toPalette(wire: PaletteWire) {
  const totals = {
    books: wire.book_total ?? 0,
    authors: wire.author_total ?? 0,
    series: wire.series_total ?? 0,
    tags: wire.tag_total ?? 0,
    genres: wire.genre_total ?? 0,
  };
  return {
    books: wire.books.map((b) => ({
      uuid: requireUuid(b.uuid, b.id),
      title: b.title,
      authorDisplay: b.author_display,
      year: b.year ?? null,
      formats: b.formats,
      hasCover: b.cover_url != null,
      accent: b.accent ?? null,
    })),
    authors: wire.authors.map((a) => ({
      id: a.id as AuthorId,
      name: a.name,
      bookCount: a.book_count,
      leadBookTitle: a.lead_book_title ?? null,
    })),
    series: wire.series.map((s) => ({
      id: s.id as SeriesId,
      name: s.name,
      bookCount: s.book_count,
      authorDisplay: s.author_display ?? null,
      leadBookTitle: s.lead_book_title ?? null,
    })),
    tags: wire.tags.map((t) => ({
      id: t.id,
      name: t.name,
      bookCount: t.book_count,
    })),
    genres: (wire.genres ?? []).map((g) => ({
      name: g.name,
      bookCount: g.book_count,
    })),
    durationMs: wire.duration_ms,
    total: Object.values(totals).reduce((sum, n) => sum + n, 0),
    totals,
  };
}

export type PaletteResults = ReturnType<typeof toPalette>;

/** One book hit in the palette or on the results page. */
export type PaletteBook = PaletteResults["books"][number];

/** The full record for one book, or `null` when no book has that uuid. */
export async function fetchBook(uuid: BookUuid): Promise<BookDetail | null> {
  const res = await getEbookByUuid(encodeURIComponent(uuid));
  if (res.status === 404) return null;
  if (res.status !== 200) throw failure(res);
  return toBookDetail(res.data);
}

/** Grouped search hits for `query`; `limit` raises the per-group cap. */
export async function fetchPalette(
  query: string,
  { limit, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<PaletteResults> {
  return toPalette(ok(await getSearchPalette({ q: query, limit }, { signal })));
}

/** The providers to ask for a summary, in the order to ask them. */
export async function fetchSummarySources(): Promise<SummarySource[]> {
  return ok(await getSummarySources());
}

const summaryText = z.string().nullable();

/** One provider's summary of the book, or `null` when it has none. Nothing is saved. */
export async function fetchSummary(
  uuid: BookUuid,
  source: SummarySource,
): Promise<string | null> {
  const res = await send(
    getPostEbookSummaryFetchUrl(encodeURIComponent(uuid)),
    "POST",
    { source },
  );
  return summaryText.parse(await res.json());
}

/** Saves `description` over the scanned one and returns the book as it now reads. */
export async function saveDescription(
  uuid: BookUuid,
  description: string,
): Promise<BookDetail> {
  return toBookDetail(
    ok(
      await postEbookOverrides(encodeURIComponent(uuid), {
        description,
      }),
    ),
  );
}

function toSuggestion(wire: BookSuggestionWire) {
  return {
    id: wire.hardcover_id,
    title: wire.title,
    author: wire.author,
    hardcoverUrl: wire.hardcover_url,
    lists: wire.list_count,
    cover: wire.cover_url ?? null,
  };
}

export type Suggestion = ReturnType<typeof toSuggestion>;

export type Suggestions =
  | { status: "not_configured" | "pending" }
  | { status: "ready"; items: Suggestion[] };

/** Hardcover's read-alikes for a book, or why there are none yet. */
export async function fetchSuggestions(uuid: BookUuid): Promise<Suggestions> {
  const data = ok(await getSuggestions(encodeURIComponent(uuid)));
  return data.status === "ready"
    ? { status: "ready", items: data.items.map(toSuggestion) }
    : { status: data.status };
}

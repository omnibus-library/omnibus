import type {
  BookFileInfo,
  EbookMetadata,
  PaletteBookHit,
  PaletteResults,
  ResumePoint,
  SeriesDetail,
  UserSummary,
} from "../api/generated/schemas";

// Fixtures in the shape the server sends them: snake_case JSON, typed by the
// generated schemas so a fixture that drifts from the spec fails to compile.
// Kept beside the parsed fixtures in books.ts.

/** A book as `GET /api/ebooks` and `GET /api/ebooks/{uuid}` send it. */
export function aWireBook(
  overrides: Partial<EbookMetadata> = {},
): EbookMetadata {
  return {
    id: 2,
    filename: "aurora-station-01.cbz",
    title: "Aurora Station, Vol. 1",
    description: null,
    publisher: null,
    published: "2021-03-01",
    language: null,
    creators: [{ name: "Sora Inkwell", role: null, file_as: null, id: 2 }],
    subjects: [],
    identifiers: [],
    series: "Aurora Station",
    series_index: "1",
    unique_identifier: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    cover_url: "/api/covers/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    accent: "oklch(0.555 0.153 28.4)",
    formats: ["CBZ"],
    error: null,
    has_override: false,
    has_cover_override: false,
    ...overrides,
  };
}

/** One of a book's files as `GET /api/ebooks/{uuid}` sends it. */
export function aWireFile(overrides: Partial<BookFileInfo> = {}): BookFileInfo {
  return {
    id: 11,
    format: "EPUB",
    filename: "aurora-station-01.epub",
    ordinal: 0,
    label: null,
    size_bytes: 3_100_000,
    ...overrides,
  };
}

/** A series as `GET /api/series/{id}` sends it. */
export function aWireSeries(
  overrides: Partial<SeriesDetail> = {},
): SeriesDetail {
  return {
    id: 4,
    name: "Aurora Station",
    book_count: 3,
    books: [],
    ...overrides,
  };
}

/** `count` distinct books, uuids and titles numbered, for paging. */
export function aWireLibrary(count: number): EbookMetadata[] {
  return Array.from({ length: count }, (_, i) =>
    aWireBook({
      id: i + 1,
      title: `Aurora Station, Vol. ${i + 1}`,
      series_index: String(i + 1),
      unique_identifier: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    }),
  );
}

/** A reading position as `GET /api/progress/recent` sends it. */
export function aWireResumePoint(
  record: Partial<ResumePoint["record"]> = {},
  book: Partial<EbookMetadata> = {},
): ResumePoint {
  return {
    record: {
      book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
      format: "epub",
      epub_cfi: "epubcfi(/6/4!/4/2/1:0)",
      audio_position_seconds: null,
      progress_percent: 42,
      kobo_location: null,
      book_file_id: null,
      updated_at: 1_760_000_000,
      client_updated_at: 1_760_000_000,
      ...record,
    },
    book: aWireBook({ formats: ["EPUB"], ...book }),
    linked: false,
  };
}

/** The signed-in admin as `GET /api/auth/me` and the login response send it. */
export const WIRE_ADA: UserSummary = {
  id: 1,
  username: "ada",
  display_name: "Ada Lovelace",
  is_admin: true,
  can_upload: true,
  can_edit: true,
  can_download: true,
  kindle_email: null,
};

/** A book hit as `GET /api/search/palette` sends it. */
export function aWirePaletteBook(
  overrides: Partial<PaletteBookHit> = {},
): PaletteBookHit {
  return {
    id: 2,
    uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    title: "Aurora Station, Vol. 1",
    author_display: "Sora Inkwell",
    year: "2021",
    formats: ["CBZ"],
    cover_url: "/api/covers/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    accent: "oklch(0.555 0.153 28.4)",
    ...overrides,
  };
}

/** `GET /api/search/palette`'s answer; the totals default to the hit counts. */
export function aWirePalette(
  overrides: Partial<PaletteResults> = {},
): PaletteResults {
  const groups: Required<
    Pick<PaletteResults, "books" | "authors" | "series" | "tags" | "genres">
  > = {
    books: [aWirePaletteBook()],
    authors: [{ id: 2, name: "Sora Inkwell", book_count: 3 }],
    series: [
      {
        id: 4,
        name: "Aurora Station",
        book_count: 3,
        author_display: "Sora Inkwell",
      },
    ],
    tags: [{ id: 9, name: "space opera", book_count: 12 }],
    genres: [{ name: "Science Fiction", book_count: 40 }],
    ...overrides,
  };
  return {
    query: "aurora",
    duration_ms: 18,
    book_total: groups.books.length,
    author_total: groups.authors.length,
    series_total: groups.series.length,
    tag_total: groups.tags.length,
    genre_total: groups.genres.length,
    ...groups,
  };
}

import type {
  AlignmentView,
  AttributedRating,
  AuthorDetail,
  BookDeletionManifest,
  BookFileInfo,
  BookInsights,
  BookProgress,
  BookSuggestion,
  EbookMetadata,
  Highlight,
  JournalEntry,
  PaletteBookHit,
  PaletteResults,
  PhysicalCopy,
  ProgressRecord,
  RatingRecord,
  ReadStatusRecord,
  ResumePoint,
  SeriesDetail,
  SeriesStack,
  SessionLogEntry,
  ShelfSummary,
  UserSummary,
  WishlistEntry,
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
    added_at: "2026-08-01T12:00:00Z",
    modified: "2026-08-02T12:00:00Z",
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

/** A saved position as `GET /api/progress/{uuid}` sends it: an EPUB one 42% in, by default. */
export function aWirePosition(
  overrides: Partial<ProgressRecord> = {},
): ProgressRecord {
  return {
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    format: "epub",
    epub_cfi: null,
    audio_position_seconds: null,
    progress_percent: 42,
    kobo_location: null,
    book_file_id: null,
    updated_at: 1_760_000_000,
    client_updated_at: 1_760_000_000,
    ...overrides,
  };
}

/** `GET /api/progress/{uuid}`'s answer for a book holding `records`. */
export function aWireProgress(...records: ProgressRecord[]): BookProgress {
  return { book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0", records };
}

/** `GET /api/books/{uuid}/alignment`'s answer; an ebook with no audio, by default. */
export function aWireAlignment(
  overrides: Partial<AlignmentView> = {},
): AlignmentView {
  return { audio_files: [], ...overrides };
}

/** A read status as `GET /api/read-status/{uuid}` sends it. */
export function aWireReadStatus(
  overrides: Partial<ReadStatusRecord> = {},
): ReadStatusRecord {
  return {
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    status: "reading",
    updated_at: 1_760_000_000,
    ...overrides,
  };
}

/** The reader's rating as `GET /api/ratings/{uuid}` sends it. */
export function aWireRating(
  overrides: Partial<RatingRecord> = {},
): RatingRecord {
  return {
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    stars: 4,
    updated_at: 1_760_000_000,
    ...overrides,
  };
}

/** Another reader's rating as `GET /api/ratings/others/{uuid}` sends it. */
export function aWireOtherRating(
  overrides: Partial<AttributedRating> = {},
): AttributedRating {
  return {
    user_id: 7,
    username: "grace",
    stars: 3.5,
    updated_at: 1_760_000_000,
    ...overrides,
  };
}

/** One sitting as `GET /api/stats/sessions` sends it: 45 minutes of reading. */
export function aWireSession(
  overrides: Partial<SessionLogEntry> = {},
): SessionLogEntry {
  return {
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    title: "Aurora Station, Vol. 1",
    format: "reading",
    started_at: 1_700_000_000,
    ended_at: 1_700_002_700,
    seconds: 2700,
    ...overrides,
  };
}

/** A saved passage as `GET /api/highlights/book/{uuid}` sends it. */
export function aWireHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: 1,
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    color: "amber",
    text: "A station at the edge of the map hears something answer.",
    note: null,
    epub_cfi_range: "epubcfi(/6/6!/4/2,/1:0,/1:20)",
    created_at: 1_760_000_000,
    ...overrides,
  };
}

/** A journal entry as `GET /api/journals/book/{uuid}` sends it: Ada's published note. */
export function aWireJournalEntry(
  overrides: Partial<JournalEntry> = {},
): JournalEntry {
  return {
    id: 1,
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    author_id: 1,
    author_name: "Ada Lovelace",
    body_md: "The footnotes have footnotes.",
    body_html: "<p>The footnotes have footnotes.</p>",
    progress: 42,
    status: "published",
    created_at: 1_760_000_000,
    updated_at: 1_760_000_000,
    ...overrides,
  };
}

/** A checked-in copy as `GET /api/physical/{uuid}/copies` sends it: Ada's, with an ISBN and no note. */
export function aWireCopy(overrides: Partial<PhysicalCopy> = {}): PhysicalCopy {
  return {
    id: 4,
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    added_by_user_id: 1,
    added_by_name: "Ada Lovelace",
    checked_in_at: 1_760_000_000,
    isbn: "9781234567897",
    note: null,
    ...overrides,
  };
}

/** The reader's wishlist entry as `GET /api/physical/{uuid}/wishlist` sends it. */
export function aWireWishlist(
  overrides: Partial<WishlistEntry> = {},
): WishlistEntry {
  return {
    id: 1,
    book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    user_id: 1,
    source: "detail",
    added_at: 1_760_000_000,
    ...overrides,
  };
}

/** The reader's record in a book as `GET /api/books/{uuid}/insights` sends it: three sittings over two days. */
export function aWireInsights(
  overrides: Partial<BookInsights> = {},
): BookInsights {
  return {
    started_at: 1_760_011_200,
    seconds_total: 3600,
    sessions: 3,
    sitting_seconds: 3000,
    longest_seconds: 1800,
    longest_started_at: 1_760_011_200,
    daily: [
      { day: "2026-08-24", seconds: 1800 },
      { day: "2026-08-20", seconds: 1800 },
    ],
    as_of_day: "2026-08-24",
    ...overrides,
  };
}

/** What an admin can delete of a book: one EPUB and no copies or reader data, by default. */
export function aWireManifest(
  overrides: Partial<BookDeletionManifest> = {},
): BookDeletionManifest {
  return {
    files: [aWireFile({ path: "sora-inkwell/aurora-station-01.epub" })],
    copies: [],
    impact: {
      bookmarks: 0,
      highlights: 0,
      journal_entries: 0,
      listening_sessions: 0,
      ratings: 0,
      reading_sessions: 0,
      shelves: 0,
    },
    ...overrides,
  };
}

/** An author as `GET /api/authors/{id}` sends them. */
export function aWireAuthor(
  overrides: Partial<AuthorDetail> = {},
): AuthorDetail {
  return {
    id: 2,
    name: "Sora Inkwell",
    book_count: 0,
    books: [],
    ...overrides,
  };
}

/** A read-alike as `GET /api/ebooks/{uuid}/suggestions` sends it. */
export function aWireSuggestion(
  overrides: Partial<BookSuggestion> = {},
): BookSuggestion {
  return {
    hardcover_id: 1,
    title: "Piranesi",
    author: "Susanna Clarke",
    hardcover_url: "https://hardcover.app/books/piranesi",
    list_count: 4,
    cover_url: null,
    ...overrides,
  };
}

/** The nth fixture uuid: valid, distinct, and readable in a failure. */
export const uuidOf = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** `count` distinct books, uuids and titles numbered, for paging. */
export function aWireLibrary(count: number): EbookMetadata[] {
  return Array.from({ length: count }, (_, i) =>
    aWireBook({
      id: i + 1,
      title: `Aurora Station, Vol. ${i + 1}`,
      series_index: String(i + 1),
      unique_identifier: uuidOf(i + 1),
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

/** A folded series as `GET /api/ebooks` sends it with `stack_series`; override what a case needs. */
export function aWireStack(overrides: Partial<SeriesStack> = {}): SeriesStack {
  return {
    lead_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    name: "Saga",
    series_id: 7,
    members: [],
    states: [],
    ...overrides,
  };
}

/** A hand-picked shelf the signed-in admin (user 1) owns, as `GET /api/shelves` sends it. */
export function aWireShelf(
  overrides: Partial<ShelfSummary> = {},
): ShelfSummary {
  return {
    id: 3,
    kind: "manual",
    name: "Winter reads",
    visibility: "private",
    accent: null,
    owner_user_id: 1,
    owner_username: "ada",
    owner_has_avatar: false,
    book_count: 2,
    cover_uuids: [],
    ...overrides,
  };
}

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

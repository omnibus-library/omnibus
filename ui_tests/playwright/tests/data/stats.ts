/** A window the stats pills offer; its wire name is the pill's test id suffix. */
export type StatsRange = "week" | "month" | "year" | "all_time";

/** A headline tile that opens a drill-in, by its test id suffix. */
export type StatsTile = "finished" | "avg-rating" | "pages" | "listening";

/** The book the household target is partway through, and where. */
export const TARGET_BOOK_TITLE = "Beta in the Series";
export const TARGET_BOOK_CFI = "epubcfi(/6/4!/4/2/2[c01]/2/1:0)";

/** One reading sitting, as `POST /api/progress/sessions` takes it. */
export type SessionSeed = {
  book_uuid: string;
  format: "epub" | "audio";
  started_at: number;
  ended_at: number;
  progress_units: number;
  utc_offset_minutes: number;
};

/** A sitting of `seconds` from `startedAt` (epoch seconds), captured at the given offset. */
export function buildSession(
  bookUuid: string,
  {
    startedAt,
    seconds,
    format,
    utcOffsetMinutes,
  }: {
    startedAt: number;
    seconds: number;
    format: SessionSeed["format"];
    utcOffsetMinutes: number;
  },
): SessionSeed {
  return {
    book_uuid: bookUuid,
    format,
    started_at: startedAt,
    ended_at: startedAt + seconds,
    progress_units: seconds,
    utc_offset_minutes: utcOffsetMinutes,
  };
}

/** A stubbed `/api/rpc/stats` answer; the client fails the whole decode without these keys. */
export function buildSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    range: "month",
    reading_seconds: 600,
    listening_seconds: 0,
    sessions: 1,
    active_days: 1,
    longest_streak_days: 1,
    busiest_week_start: null,
    busiest_week_seconds: 600,
    books_finished: 1,
    heatmap: [],
    top_authors: [],
    top_tags: [],
    finished_books: [],
    ...overrides,
  };
}

/** A stubbed `/api/rpc/library-composition` answer, with publishers deliberately empty. */
export const LIBRARY_COMPOSITION = {
  books: 1510,
  ghosted_books: 4,
  formats: {
    slices: [
      { label: "EPUB", books: 1400 },
      { label: "M4B", books: 180 },
    ],
    // 1,580 placements over 1,510 books: seventy are held in both formats.
    coverage: { total: 1580, books: 1510 },
  },
  languages: {
    slices: [{ label: "eng", books: 1180 }],
    coverage: { total: 1180, books: 1180 },
  },
  publishers: { slices: [], coverage: { total: 0, books: 0 } },
  decades: {
    slices: [
      { label: "1990s", books: 200 },
      { label: "2000s", books: 620 },
    ],
    coverage: { total: 820, books: 820 },
  },
  genres: {
    slices: [
      { label: "Fantasy", books: 40 },
      { label: "Horror", books: 22 },
    ],
    // Genres are hand-assigned, so 62 placements over 58 books sample the 1,510.
    coverage: { total: 62, books: 58 },
  },
};

import { HttpResponse, http } from "msw";
import { getGetMeMockHandler200 } from "../api/generated/omnibus.msw";
import {
  type ChartResult,
  ChartSpec,
  type HouseholdReader,
  type LibraryComposition,
  type LibrarySize,
  type ResumePoint,
  SetShareStats,
  StatsRange,
  type StatsSummary,
} from "../api/generated/schemas";
import { WIRE_ADA } from "./wire";

// MSW fakes and fixtures for the stats page and the chart builder, in the shape
// the server sends them: snake_case JSON, typed by the generated schemas.

/** A full month of one reader's stats, every optional field present; override what a case needs. */
export function aWireStatsSummary(
  overrides: Partial<StatsSummary> = {},
): StatsSummary {
  return {
    range: "month",
    reading_seconds: 54_000,
    listening_seconds: 18_000,
    avg_stars: 4.25,
    sessions: 31,
    active_days: 12,
    longest_streak_days: 20,
    current_streak_days: 12,
    busiest_week_start: "2026-08-03",
    busiest_week_seconds: 21_600,
    books_finished: 3,
    books_active: 5,
    genre_tagged_books: 4,
    as_of_day: "2026-08-14",
    heatmap: Array.from({ length: 12 }, (_, i) => ({
      day: `2026-08-${String(3 + i).padStart(2, "0")}`,
      seconds: 1800 + i * 300,
    })),
    top_authors: [{ name: "Sora Inkwell", seconds: 30_000 }],
    top_tags: [{ name: "Space opera", seconds: 24_000 }],
    genre_share: [
      { name: "Fantasy", books: 2 },
      { name: "Science fiction", books: 2 },
    ],
    finished_books: [
      {
        book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
        title: "Aurora Station, Vol. 1",
        author: "Sora Inkwell",
        finished_at: 1_786_000_000,
        finished_at_iso: "2026-08-06T07:06:40Z",
        cover_url: "/api/covers/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
        rating: 4.5,
      },
    ],
    books_per_month: [
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ].map((month, i) => ({ month, books: i % 4 })),
    previous: {
      books_finished: 2,
      avg_stars: 4,
      listening_seconds: 9000,
      pages_read: 900,
    },
    listening_daily: [{ day: "2026-08-12", seconds: 3600 }],
    rating_monthly: [
      { label: "2026-07", value: 4.5 },
      { label: "2026-08", value: 4.25 },
    ],
    rating_histogram: Array.from({ length: 10 }, (_, i) => ({
      half_stars: i + 1,
      books: i === 8 ? 2 : 0,
    })),
    pages_read: 1240,
    pages_per_hour: 38.5,
    length_buckets: [
      { label: "Under 200", books: 1 },
      { label: "200–400", books: 1 },
      { label: "Unknown", books: 1 },
    ],
    hour_of_day: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      seconds: { 7: 1800, 20: 5400, 21: 3600 }[hour] ?? 0,
    })),
    day_of_week: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
      (label, weekday) => ({ weekday, label, seconds: weekday * 1000 }),
    ),
    unzoned_seconds: 0,
    superlatives: {
      longest_book: {
        book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
        title: "Aurora Station, Vol. 1",
        author: "Sora Inkwell",
        value: 612,
      },
      shortest_book: {
        book_uuid: "5b1c3c52-1d9e-4f5c-8a4e-0b6a2f7d9e11",
        title: "The Salt Road",
        author: "Mara Okafor",
        value: 148,
      },
      biggest_day: { day: "2026-08-14", seconds: 12_000 },
      longest_sit: {
        book_uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
        title: "Aurora Station, Vol. 1",
        author: "Sora Inkwell",
        value: 7200,
      },
      fastest_read: {
        book_uuid: "5b1c3c52-1d9e-4f5c-8a4e-0b6a2f7d9e11",
        title: "The Salt Road",
        author: "Mara Okafor",
        value: 2,
      },
    },
    goal: { kind: "books", target: 24, current: 18, year: 2026 },
    books_this_year: 18,
    daily_goals: {
      pages: { kind: "pages", target: 30, current: 12, day: "2026-08-14" },
      minutes: { kind: "minutes", target: 45, current: 50, day: "2026-08-14" },
      pages_today: 12,
      minutes_today: 50,
      unzoned_seconds: 0,
    },
    pages_detail: {
      audio_books: 1,
      measured_books: 3,
      unmeasured_books: 1,
      since_day: "2026-01-01",
      daily: [{ label: "2026-08-13", value: 30 }],
      window_predates_ledger: false,
    },
    ...overrides,
  };
}

/** A household reader as `GET /api/users` lists them; the caller by default. */
export function aWireReader(
  overrides: Partial<HouseholdReader> = {},
): HouseholdReader {
  return {
    id: 1,
    name: "Ada Lovelace",
    has_avatar: false,
    is_you: true,
    ...overrides,
  };
}

/** `GET /api/library-size`: every figure measured over most of the shelf. */
export function aWireLibrarySize(
  overrides: Partial<LibrarySize> = {},
): LibrarySize {
  return {
    books: 1510,
    words: { books: 1400, total: 412_000_000 },
    pages: { books: 1500, total: 1_500_000 },
    listening_seconds: { books: 90, total: 3_600_000 },
    ...overrides,
  };
}

/** `GET /api/library-composition`: every dimension measured over the whole shelf. */
export function aWireLibraryComposition(
  overrides: Partial<LibraryComposition> = {},
): LibraryComposition {
  const dimension = (slices: [string, number][]) => ({
    coverage: { books: 1510, total: slices.reduce((n, [, b]) => n + b, 0) },
    slices: slices.map(([label, books]) => ({ label, books })),
  });
  return {
    books: 1510,
    ghosted_books: 0,
    formats: dimension([
      ["EPUB", 1200],
      ["M4B", 310],
    ]),
    languages: dimension([["English", 1400]]),
    publishers: dimension([["Lantern Press", 90]]),
    decades: dimension([["1990s", 120]]),
    genres: dimension([["Fantasy", 80]]),
    ...overrides,
  };
}

/** `POST /api/stats/chart`: one bar series of books finished over three months. */
export function aWireChartResult(
  overrides: Partial<ChartResult> = {},
): ChartResult {
  return {
    bucket: "month",
    buckets: ["2026-06", "2026-07", "2026-08"],
    series: [
      {
        measure: "books_finished",
        axis: 0,
        mark: "bar",
        values: [1, 2, 3],
      },
    ],
    axes: [{ unit: "books", max: 4 }],
    divisions: 4,
    stacked: false,
    truncated: false,
    caveats: [],
    ...overrides,
  };
}

type StatsRoute =
  | "stats"
  | "readers"
  | "recent"
  | "size"
  | "composition"
  | "share"
  | "chart";

/** What the handlers saw: each route's search params, and the two POST bodies. */
export type StatsCalls = Record<StatsRoute, URLSearchParams[]> & {
  shares: SetShareStats[];
  specs: ChartSpec[];
};

/** An empty record of calls, for a story to start from. */
export const noStatsCalls = (): StatsCalls => ({
  stats: [],
  readers: [],
  recent: [],
  size: [],
  composition: [],
  share: [],
  chart: [],
  shares: [],
  specs: [],
});

// A status number answers as that failure, with the plain text the server sends.
const answer = (value: object | number) =>
  typeof value === "number"
    ? new HttpResponse(`failed with ${value}`, { status: value })
    : HttpResponse.json(value);

/**
 * Every route the stats page and the chart builder read. `stats` and `chart` choose the
 * answer per request (`stats` may hold one back); any answer may be a status number instead,
 * to fail that route. Each request lands in `calls`.
 * The session reports what the sharing switch saved (off to start), `refuseShare` makes
 * the save answer 400, and `holdShare` holds it until it resolves.
 */
export function statsHandlers({
  stats = ({ range }) => aWireStatsSummary({ range }),
  readers = [aWireReader()],
  recent = [],
  size = aWireLibrarySize(),
  composition = aWireLibraryComposition(),
  chart = () => aWireChartResult(),
  refuseShare = false,
  holdShare = Promise.resolve(),
  calls = noStatsCalls(),
}: {
  stats?: (query: {
    range: StatsRange;
    userId: number | null;
  }) => StatsSummary | number | Promise<StatsSummary | number>;
  readers?: HouseholdReader[] | number;
  recent?: ResumePoint[] | number;
  size?: LibrarySize | number;
  composition?: LibraryComposition | number;
  chart?: (spec: ChartSpec) => ChartResult | number;
  refuseShare?: boolean;
  holdShare?: Promise<void>;
  calls?: StatsCalls;
} = {}) {
  let shared = false;
  const seen = (route: StatsRoute, request: Request) => {
    const params = new URL(request.url).searchParams;
    calls[route].push(params);
    return params;
  };
  return [
    http.get("/api/stats", async ({ request }) => {
      const params = seen("stats", request);
      const user = params.get("user_id");
      return answer(
        await stats({
          range: StatsRange.parse(params.get("range")),
          userId: user === null ? null : Number(user),
        }),
      );
    }),
    http.get("/api/users", ({ request }) => {
      seen("readers", request);
      return answer(readers);
    }),
    http.get("/api/progress/recent", ({ request }) => {
      seen("recent", request);
      return answer(recent);
    }),
    http.get("/api/library-size", ({ request }) => {
      seen("size", request);
      return answer(size);
    }),
    http.get("/api/library-composition", ({ request }) => {
      seen("composition", request);
      return answer(composition);
    }),
    getGetMeMockHandler200(() => ({ ...WIRE_ADA, share_stats: shared })),
    http.post("/api/account/share-stats", async ({ request }) => {
      seen("share", request);
      const body = SetShareStats.parse(await request.json());
      calls.shares.push(body);
      await holdShare;
      if (refuseShare)
        return new HttpResponse("failed with 400", { status: 400 });
      shared = body.enabled;
      return new HttpResponse(null);
    }),
    http.post("/api/stats/chart", async ({ request }) => {
      seen("chart", request);
      const spec = ChartSpec.parse(await request.json());
      calls.specs.push(spec);
      return answer(chart(spec));
    }),
  ];
}

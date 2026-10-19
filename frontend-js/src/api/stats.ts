import { queryOptions } from "@tanstack/react-query";
import { ApiError, ok, type UserId, utcOffsetMinutes } from "./core";
import {
  getHouseholdReaders,
  getLibraryComposition,
  getLibrarySize,
  getStats,
  postStatsChart,
} from "./generated/omnibus";
import type {
  ChartSpec,
  LibraryComposition as LibraryCompositionWire,
  LibrarySize as LibrarySizeWire,
  StatsRange,
  StatsSummary as StatsSummaryWire,
} from "./generated/schemas";

export type {
  ChartResult,
  ChartSpec,
  HouseholdReader,
  StatsRange,
} from "./generated/schemas";

// The stats and chart answers stay wire-shaped (snake_case): each helper behind the
// page is a port of its Rust over the same field names. The one mapping is filling
// every field the server may omit with its Rust `Default`, once, so no screen does.

const UNMEASURED = { books: 0, total: 0 };

/** One reader's stats for one period, every field the server may omit at its default. */
export function toStatsSummary(wire: StatsSummaryWire) {
  const goals = wire.daily_goals;
  const pages = wire.pages_detail;
  const previous = wire.previous;
  const records = wire.superlatives;
  return {
    ...wire,
    as_of_day: wire.as_of_day ?? "",
    avg_stars: wire.avg_stars ?? null,
    books_active: wire.books_active ?? 0,
    books_per_month: wire.books_per_month ?? [],
    books_this_year: wire.books_this_year ?? null,
    busiest_week_start: wire.busiest_week_start ?? null,
    current_streak_days: wire.current_streak_days ?? 0,
    daily_goals: {
      pages: goals?.pages ?? null,
      minutes: goals?.minutes ?? null,
      pages_today: goals?.pages_today ?? null,
      minutes_today: goals?.minutes_today ?? null,
      unzoned_seconds: goals?.unzoned_seconds ?? 0,
    },
    day_of_week: wire.day_of_week ?? [],
    genre_share: wire.genre_share ?? [],
    genre_tagged_books: wire.genre_tagged_books ?? 0,
    goal: wire.goal ?? null,
    hour_of_day: wire.hour_of_day ?? [],
    length_buckets: wire.length_buckets ?? [],
    listening_daily: wire.listening_daily ?? [],
    pages_detail: {
      audio_books: pages?.audio_books ?? 0,
      daily: pages?.daily ?? [],
      measured_books: pages?.measured_books ?? 0,
      since_day: pages?.since_day ?? null,
      unmeasured_books: pages?.unmeasured_books ?? 0,
      window_predates_ledger: pages?.window_predates_ledger ?? false,
    },
    pages_per_hour: wire.pages_per_hour ?? null,
    pages_read: wire.pages_read ?? null,
    previous: {
      avg_stars: previous?.avg_stars ?? null,
      books_finished: previous?.books_finished ?? 0,
      listening_seconds: previous?.listening_seconds ?? 0,
      pages_read: previous?.pages_read ?? 0,
    },
    rating_histogram: wire.rating_histogram ?? [],
    rating_monthly: wire.rating_monthly ?? [],
    superlatives: {
      biggest_day: records?.biggest_day ?? null,
      fastest_read: records?.fastest_read ?? null,
      longest_book: records?.longest_book ?? null,
      longest_sit: records?.longest_sit ?? null,
      shortest_book: records?.shortest_book ?? null,
    },
    unzoned_seconds: wire.unzoned_seconds ?? 0,
  };
}

export type StatsSummary = ReturnType<typeof toStatsSummary>;

/** How big the library is, each figure the server omits as an unmeasured total. */
export function toLibrarySize(wire: LibrarySizeWire) {
  return {
    books: wire.books,
    words: wire.words ?? UNMEASURED,
    pages: wire.pages ?? UNMEASURED,
    listening_seconds: wire.listening_seconds ?? UNMEASURED,
  };
}

export type LibrarySize = ReturnType<typeof toLibrarySize>;

function toDimension(wire: LibraryCompositionWire["formats"]) {
  return { coverage: wire?.coverage ?? UNMEASURED, slices: wire?.slices ?? [] };
}

/** What the library is made of, each dimension the server omits with no coverage and no slices. */
export function toLibraryComposition(wire: LibraryCompositionWire) {
  return {
    books: wire.books,
    ghosted_books: wire.ghosted_books ?? 0,
    formats: toDimension(wire.formats),
    languages: toDimension(wire.languages),
    publishers: toDimension(wire.publishers),
    decades: toDimension(wire.decades),
    genres: toDimension(wire.genres),
  };
}

export type LibraryComposition = ReturnType<typeof toLibraryComposition>;

/** One reader's stats for `range`; `userId` reads another reader's, which the server may refuse with a 404. */
export async function fetchStats(
  range: StatsRange,
  userId: UserId | null,
): Promise<StatsSummary> {
  const params = {
    range,
    utc_offset_minutes: utcOffsetMinutes(),
    ...(userId === null ? {} : { user_id: userId }),
  };
  return toStatsSummary(ok(await getStats(params)));
}

/** Whether a failed stats read is the server refusing another reader's stats. */
export const isNotSharing = (error: unknown) =>
  error instanceof ApiError && error.status === 404;

/** The readers whose stats the caller may view, the caller first. */
export async function fetchHouseholdReaders() {
  return ok(await getHouseholdReaders());
}

/** How big the whole library is. */
export async function fetchLibrarySize(): Promise<LibrarySize> {
  return toLibrarySize(ok(await getLibrarySize()));
}

/** What the whole library is made of. */
export async function fetchLibraryComposition(): Promise<LibraryComposition> {
  return toLibraryComposition(ok(await getLibraryComposition()));
}

/** The series a chart spec asks for; a spec the builder can't draw is a 422 carrying its reason. */
export async function fetchChartSeries(spec: ChartSpec) {
  return ok(
    await postStatsChart(spec, { utc_offset_minutes: utcOffsetMinutes() }),
  );
}

export const statsQuery = (range: StatsRange, userId: UserId | null) =>
  queryOptions({
    queryKey: ["stats", userId, range],
    queryFn: () => fetchStats(range, userId),
  });

// The three reads below are context beside the reader's own figures, so a failure
// settles on the empty answer rather than blanking the page.
export const householdReadersQuery = queryOptions({
  queryKey: ["household-readers"],
  queryFn: () => fetchHouseholdReaders().catch(() => []),
});

export const librarySizeQuery = queryOptions({
  queryKey: ["library-size"],
  queryFn: () => fetchLibrarySize().catch(() => toLibrarySize({ books: 0 })),
});

export const libraryCompositionQuery = queryOptions({
  queryKey: ["library-composition"],
  queryFn: () =>
    fetchLibraryComposition().catch(() => toLibraryComposition({ books: 0 })),
});

export const chartQuery = (spec: ChartSpec) =>
  queryOptions({
    queryKey: ["stats-chart", spec],
    queryFn: () => fetchChartSeries(spec),
    enabled: spec.measures.length > 0,
  });

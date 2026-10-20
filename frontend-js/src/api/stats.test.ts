import { describe, expect, it } from "vitest";
import {
  aWireLibraryComposition,
  aWireLibrarySize,
  aWireStatsSummary,
} from "../testing/statsHandlers";
import type { StatsSummary as StatsSummaryWire } from "./generated/schemas";
import { toLibraryComposition, toLibrarySize, toStatsSummary } from "./stats";

// The fields the server always sends; everything else is a serde default.
const REQUIRED: StatsSummaryWire = {
  range: "month",
  active_days: 0,
  books_finished: 0,
  busiest_week_seconds: 0,
  finished_books: [],
  heatmap: [],
  listening_seconds: 0,
  longest_streak_days: 0,
  reading_seconds: 0,
  sessions: 0,
  top_authors: [],
  top_tags: [],
};

describe("toStatsSummary", () => {
  it("fills every field the server may omit with its Rust default", () => {
    expect(toStatsSummary(REQUIRED)).toEqual({
      ...REQUIRED,
      as_of_day: "",
      avg_stars: null,
      books_active: 0,
      books_per_month: [],
      books_this_year: null,
      busiest_week_start: null,
      current_streak_days: 0,
      daily_goals: {
        pages: null,
        minutes: null,
        pages_today: null,
        minutes_today: null,
        unzoned_seconds: 0,
      },
      day_of_week: [],
      genre_share: [],
      genre_tagged_books: 0,
      goal: null,
      hour_of_day: [],
      length_buckets: [],
      listening_daily: [],
      pages_detail: {
        audio_books: 0,
        daily: [],
        measured_books: 0,
        since_day: null,
        unmeasured_books: 0,
        window_predates_ledger: false,
      },
      pages_per_hour: null,
      pages_read: null,
      previous: {
        avg_stars: null,
        books_finished: 0,
        listening_seconds: 0,
        pages_read: 0,
      },
      rating_histogram: [],
      rating_monthly: [],
      superlatives: {
        biggest_day: null,
        fastest_read: null,
        longest_book: null,
        longest_sit: null,
        shortest_book: null,
      },
      unzoned_seconds: 0,
    });
  });

  it("passes a full summary through unchanged", () => {
    const wire = aWireStatsSummary();

    expect(toStatsSummary(wire)).toEqual(wire);
  });

  it("keeps what a partial block carries and defaults the rest of it", () => {
    const summary = toStatsSummary({
      ...REQUIRED,
      daily_goals: {
        pages: { kind: "pages", target: 30, current: 12, day: "2026-08-14" },
      },
      pages_detail: { audio_books: 1, measured_books: 2, unmeasured_books: 3 },
      previous: { books_finished: 4, listening_seconds: 60 },
      superlatives: { biggest_day: { day: "2026-08-14", seconds: 600 } },
    });

    expect(summary.daily_goals).toEqual({
      pages: { kind: "pages", target: 30, current: 12, day: "2026-08-14" },
      minutes: null,
      pages_today: null,
      minutes_today: null,
      unzoned_seconds: 0,
    });
    expect(summary.pages_detail).toEqual({
      audio_books: 1,
      daily: [],
      measured_books: 2,
      since_day: null,
      unmeasured_books: 3,
      window_predates_ledger: false,
    });
    expect(summary.previous).toEqual({
      avg_stars: null,
      books_finished: 4,
      listening_seconds: 60,
      pages_read: 0,
    });
    expect(summary.superlatives).toEqual({
      biggest_day: { day: "2026-08-14", seconds: 600 },
      fastest_read: null,
      longest_book: null,
      longest_sit: null,
      shortest_book: null,
    });
  });
});

describe("toLibrarySize", () => {
  it("fills each figure the server omits with an unmeasured total", () => {
    expect(toLibrarySize({ books: 12 })).toEqual({
      books: 12,
      words: { books: 0, total: 0 },
      pages: { books: 0, total: 0 },
      listening_seconds: { books: 0, total: 0 },
    });
  });

  it("passes a full size through unchanged", () => {
    const wire = aWireLibrarySize();

    expect(toLibrarySize(wire)).toEqual(wire);
  });
});

describe("toLibraryComposition", () => {
  it("fills each dimension the server omits with no coverage and no slices", () => {
    const empty = { coverage: { books: 0, total: 0 }, slices: [] };

    expect(toLibraryComposition({ books: 12 })).toEqual({
      books: 12,
      ghosted_books: 0,
      formats: empty,
      languages: empty,
      publishers: empty,
      decades: empty,
      genres: empty,
    });
  });

  it("defaults the coverage of a dimension that carries slices alone", () => {
    const composition = toLibraryComposition({
      books: 12,
      formats: { slices: [{ label: "EPUB", books: 12 }] },
    });

    expect(composition.formats).toEqual({
      coverage: { books: 0, total: 0 },
      slices: [{ label: "EPUB", books: 12 }],
    });
  });

  it("passes a full composition through unchanged", () => {
    const wire = aWireLibraryComposition();

    expect(toLibraryComposition(wire)).toEqual(wire);
  });
});

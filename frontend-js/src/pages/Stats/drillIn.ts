import type { StatsRange, StatsSummary } from "../../api";
import { fixed, plural } from "../../format";
import { monthAbbr } from "./calendar";
import { avgStarsValue, clampPct, type Direction, type Metric } from "./tiles";

type RatingBucket = StatsSummary["rating_histogram"][number];
type TrendPoint = StatsSummary["rating_monthly"][number];
type Pages = StatsSummary["pages_detail"];

/** One trend column: a short axis label, its hover title and a height up to 100. */
export type TrendBar = {
  label: string;
  title: string;
  heightPct: number;
  /** The figure printed on the column, so its height reads without hovering. */
  value: string | null;
  /** Nothing was measured here: an empty slot, never a stub that reads as a low value. */
  empty: boolean;
};

export const METRIC_TITLES = {
  finished: "Finished",
  avg_rating: "Avg rating",
  listening: "Listening",
  pages: "Pages read",
} as const satisfies Record<Metric, string>;

/** "vs last month" and so on; empty for Lifetime, which has no previous window. */
export function vsLabel(range: StatsRange): string {
  switch (range) {
    case "week":
      return "vs last week";
    case "month":
      return "vs last month";
    case "year":
      return "vs last year";
    case "all_time":
      return "";
    default: {
      const _exhaustive: never = range;
      return _exhaustive;
    }
  }
}

const GLYPHS = {
  up: "▲",
  down: "▼",
  flat: "●",
} as const satisfies Record<Direction, string>;

/** The arrow beside a comparison's label: the tile tints its delta, the sheet draws a glyph. */
export const glyph = (direction: Direction) => GLYPHS[direction];

/** `(year, month)` of a `YYYY-MM` month, `null` when malformed. */
function yearMonth(month: string): [number, number] | null {
  const parts = /^(\d+)-(\d+)$/.exec(month);
  if (!parts) return null;
  const m = Number(parts[2]);
  return m >= 1 && m <= 12 ? [Number(parts[1]), m] : null;
}

/** The three-letter name of a `YYYY-MM` month, `?` when malformed. Never an initial: June and July would share "J". */
export function shortMonth(month: string): string {
  const parsed = yearMonth(month);
  return parsed ? monthAbbr(parsed[1]) : "?";
}

/** "Oct 2025" for a `YYYY-MM` month, `null` when malformed. */
function monthYear(month: string): string | null {
  const parsed = yearMonth(month);
  return parsed ? `${monthAbbr(parsed[1])} ${parsed[0]}` : null;
}

/** The two-digit day of month of a `YYYY-MM-DD` day, `?` when malformed. */
export function shortDay(day: string): string {
  const last = day.includes("-") ? day.split("-").pop() : undefined;
  const n = last !== undefined && /^\d+$/.test(last) ? Number(last) : 0;
  return n >= 1 && n <= 31 ? String(n).padStart(2, "0") : "?";
}

/** A column's height against the series' tallest point; an all-zero series stays all zero. */
const barHeight = (value: number, max: number) =>
  max <= 0 ? 0 : clampPct((Math.max(value, 0) / max) * 100);

/** Any of the summary's label/value series as bars scaled to the tallest. */
export function buildTrendBars(
  points: readonly (readonly [label: string, value: number])[],
): TrendBar[] {
  const max = Math.max(0, ...points.map(([, value]) => value));
  return points.map(([label, value]) => ({
    label,
    title: label,
    heightPct: barHeight(value, max),
    value: null,
    empty: false,
  }));
}

/** A rating bucket's axis label in stars, "0.5" to "5": the buckets are half-stars, which would read as a ten-point scale. */
export const starLabel = ({ half_stars }: RatingBucket) =>
  half_stars % 2 === 0 ? fixed(half_stars / 2, 0) : fixed(half_stars / 2, 1);

/** One bar per half-star bucket carrying its book count; an empty bucket keeps its column but draws no bar a reader could take for a small one. */
export function buildHistogramBars(
  buckets: readonly RatingBucket[],
): TrendBar[] {
  const max = Math.max(0, ...buckets.map((b) => b.books));
  return buckets.map((bucket) => {
    const label = starLabel(bucket);
    const empty = bucket.books <= 0;
    return {
      label,
      title: `${label} ★ · ${bucket.books} book${plural(bucket.books)}`,
      heightPct: barHeight(bucket.books, max),
      value: empty ? null : String(bucket.books),
      empty,
    };
  });
}

/** Each month's mean on a fixed five-star scale, so a bar's height is the rating rather than its share of the best month; an unrated month is an empty slot. */
export function buildRatingTrendBars(
  points: readonly TrendPoint[],
): TrendBar[] {
  return points.map((point) => {
    const month = monthYear(point.label) ?? point.label;
    const empty = point.value <= 0;
    const value = empty ? null : avgStarsValue(point.value);
    return {
      label: shortMonth(point.label),
      title: value === null ? `${month} · no ratings` : `${month} · ${value} ★`,
      heightPct: clampPct((point.value / 5) * 100),
      value,
      empty,
    };
  });
}

/** The metric's trend as bars: the rating on its own scale, every other metric scaled to its tallest point. */
export function trendBars(
  metric: Metric,
  summary: Pick<
    StatsSummary,
    "books_per_month" | "rating_monthly" | "listening_daily" | "pages_detail"
  >,
): TrendBar[] {
  switch (metric) {
    case "avg_rating":
      return buildRatingTrendBars(summary.rating_monthly);
    case "finished":
      return buildTrendBars(
        summary.books_per_month.map((m) => [shortMonth(m.month), m.books]),
      );
    case "listening":
      return buildTrendBars(
        summary.listening_daily.map((d) => [shortDay(d.day), d.seconds / 60]),
      );
    case "pages":
      return buildTrendBars(
        summary.pages_detail.daily.map((p) => [shortDay(p.label), p.value]),
      );
    default: {
      const _exhaustive: never = metric;
      return _exhaustive;
    }
  }
}

/** The heading a trend needs to be read: the rating trend sits beside a histogram and covers a different period. */
export const trendTitle = (metric: Metric) =>
  metric === "avg_rating" ? "Average rating by month" : null;

const RATING_TREND_SPAN = "last 12 months, whatever period is selected";

/** The period the rating trend covers: the trailing twelve months whatever the switcher says, while the delta and histogram follow it. */
export function ratingTrendCaption(points: readonly TrendPoint[]): string {
  const first = points.at(0);
  const last = points.at(-1);
  const from = first && monthYear(first.label);
  const to = last && monthYear(last.label);
  return from && to
    ? `${from} – ${to} · the ${RATING_TREND_SPAN}`
    : `The ${RATING_TREND_SPAN}`;
}

/** The period the rating histogram covers: the one the switcher selected. */
export function histogramCaption(range: StatsRange): string {
  switch (range) {
    case "week":
      return "Rated this week";
    case "month":
      return "Rated this month";
    case "year":
      return "Rated this year";
    case "all_time":
      return "Rated at any time";
    default: {
      const _exhaustive: never = range;
      return _exhaustive;
    }
  }
}

/** A reading rate: one decimal under ten pages an hour, whole pages above, since a decimal would dress an estimate as a measurement. The branch tests the rounded figure, as 9.96 at one decimal is "10.0". */
export function rateValue(rate: number): string {
  const oneDecimal = Math.round(rate * 10) / 10;
  return oneDecimal < 10 ? fixed(oneDecimal, 1) : String(Math.round(rate));
}

/** "Across N books this period.": the population behind the headline. */
export const measuredLine = (books: number) =>
  `Across ${books} book${plural(books)} this period.`;

/** The books whose length nothing resolves, named rather than absorbed: they were read, and the total leaves them out. */
export function unmeasuredLine(books: number, anyMeasured: boolean): string {
  const verb = books === 1 ? "has" : "have";
  const pronoun = books === 1 ? "it" : "they";
  // "more" only reads as English when a count came before it.
  const more = anyMeasured ? "more " : "";
  return `${books} ${more}book${plural(books)} ${verb} no known length yet, so nothing ${pronoun} contributed is counted.`;
}

/** Whether the window opens before page tracking began, so part of it is unmeasurable whatever the reader did. */
export const predatesLedger = (detail: Pages) =>
  detail.since_day !== null && detail.window_predates_ledger;

/** The cutover sentence: no trail of stored positions exists before the ledger began, so earlier reading is unrecoverable, not merely missing. */
export const cutoverLine = (since: string, overlaps: boolean) =>
  overlaps
    ? `Page tracking began ${since}; reading before then can’t be counted, so this period is only partly covered.`
    : `Page tracking began ${since}.`;

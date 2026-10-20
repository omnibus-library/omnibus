import type { StatsSummary } from "../../api";
import { fixed } from "../../format";
import { groupThousands } from "./summary";

/** Which headline tile a drill-in sheet is showing detail for. */
export type Metric = "finished" | "avg_rating" | "listening" | "pages";

export type Direction = "up" | "down" | "flat";

/** How a tile's figure compares with the same slice of the previous window: the signed label, and the bar's fill, 0 to 100. */
export type Comparison = {
  label: string;
  direction: Direction;
  fillPct: number;
};

type Pages = StatsSummary["pages_detail"];

const MINUS = "−";

/** `value` as a whole percent held between 0 and 100. */
export const clampPct = (value: number) =>
  Math.round(Math.min(Math.max(value, 0), 100));

/** Listening with no reading at all, the one empty state whose correct headline is `0`, not an em-dash. */
export const audioOnly = (detail: Pages) =>
  detail.audio_books > 0 &&
  detail.measured_books === 0 &&
  detail.unmeasured_books === 0;

/** How close this window has come to the last, capped once past it; a window with no baseline fills when it has something to show. */
export function fillPct(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return clampPct((current / previous) * 100);
}

const directionOf = (change: number): Direction =>
  change > 0 ? "up" : change < 0 ? "down" : "flat";

/** A count delta in whole units, "+2", "−1" or "flat", since a percentage over a handful of books is noise. */
export function countComparison(current: number, previous: number): Comparison {
  const change = current - previous;
  return {
    label:
      change === 0 ? "flat" : `${change > 0 ? "+" : MINUS}${Math.abs(change)}`,
    direction: directionOf(change),
    fillPct: fillPct(current, previous),
  };
}

/** A magnitude delta as a percentage, for pages and seconds where the absolute change carries no scale; "new" when the previous window recorded none. */
export function percentComparison(
  current: number,
  previous: number,
): Comparison {
  const fill = fillPct(current, previous);
  if (previous <= 0) {
    return current > 0
      ? { label: "new", direction: "up", fillPct: fill }
      : { label: "flat", direction: "flat", fillPct: fill };
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) {
    return { label: "flat", direction: "flat", fillPct: fill };
  }
  // Capped like Rust's i32 clamp, so a divide by a near-zero baseline can't print an absurd figure.
  const pct = Math.min(Math.round(Math.abs(change)), 2_147_483_647);
  return {
    label: `${change > 0 ? "+" : MINUS}${pct}%`,
    direction: directionOf(change),
    fillPct: fill,
  };
}

/**
 * A star delta in stars, drawn against the five-star ceiling, since a ratio between two means would reach
 * 100% for any window rated as well as the last. `null` without a mean to report.
 */
export function starsComparison(
  current: number | null,
  previous: number | null,
): Comparison | null {
  if (current === null) return null;
  const fill = clampPct((current / 5) * 100);
  if (previous === null)
    return { label: "new", direction: "up", fillPct: fill };
  const change = current - previous;
  if (Math.abs(change) < 0.05) {
    return { label: "flat", direction: "flat", fillPct: fill };
  }
  return {
    label: `${change > 0 ? "+" : MINUS}${fixed(Math.abs(change), 1)}`,
    direction: directionOf(change),
    fillPct: fill,
  };
}

type Compared = Pick<
  StatsSummary,
  | "range"
  | "books_finished"
  | "pages_read"
  | "listening_seconds"
  | "avg_stars"
  | "previous"
>;

/**
 * A metric's comparison against the same slice of the previous window, as the one value its tile and
 * its drill-in both state. `null` on Lifetime, which has no previous window, and for a rating with no mean.
 */
export function comparison(
  metric: Metric,
  summary: Compared,
): Comparison | null {
  if (summary.range === "all_time") return null;
  const { previous } = summary;
  switch (metric) {
    case "finished":
      return countComparison(summary.books_finished, previous.books_finished);
    case "pages":
      return percentComparison(summary.pages_read ?? 0, previous.pages_read);
    case "listening":
      return percentComparison(
        summary.listening_seconds,
        previous.listening_seconds,
      );
    case "avg_rating":
      return starsComparison(summary.avg_stars, previous.avg_stars);
    default: {
      const _exhaustive: never = metric;
      return _exhaustive;
    }
  }
}

/** A duration tile's value and unit: minutes under an hour, one-decimal hours under ten, whole hours beyond. */
export function durationValue(secs: number): { value: string; unit: string } {
  if (secs < 3600) return { value: String(Math.trunc(secs / 60)), unit: "min" };
  const hours = secs / 3600;
  return {
    value: hours < 10 ? fixed(hours, 1) : String(Math.floor(hours)),
    unit: "hours",
  };
}

/** The mean to one decimal, rounding half up so 4.25 reads 4.3 rather than `{:.1}`'s 4.2; an em-dash, never NaN or 0.0, when unrated. */
export const avgStarsValue = (avg: number | null) =>
  avg === null ? "—" : fixed(Math.round(avg * 10) / 10, 1);

/** The page count grouped in thousands; `null` is `0` for a window of pure listening and an em-dash for anything else the ladder couldn't measure. */
export function pagesValue(pages: number | null, isAudioOnly: boolean): string {
  if (pages !== null) return groupThousands(pages);
  return isAudioOnly ? "0" : "—";
}

export type Tile = {
  value: string;
  unit: string;
  label: string;
  testid: string;
  metric: Metric;
  accent: boolean;
  comparison: Comparison | null;
};

/** Every tile in reading order, each metric's comparison already chosen. */
export function buildTiles(
  summary: Compared & Pick<StatsSummary, "pages_detail">,
): Tile[] {
  const listening = durationValue(summary.listening_seconds);
  return [
    {
      value: String(summary.books_finished),
      unit: "books",
      label: "Finished",
      testid: "stats-tile-finished",
      metric: "finished",
      accent: true,
      comparison: comparison("finished", summary),
    },
    {
      value: pagesValue(summary.pages_read, audioOnly(summary.pages_detail)),
      unit: "pages",
      label: "Pages read",
      testid: "stats-tile-pages",
      metric: "pages",
      accent: false,
      comparison: comparison("pages", summary),
    },
    {
      value: listening.value,
      unit: listening.unit,
      label: "Listening",
      testid: "stats-tile-listening",
      metric: "listening",
      accent: false,
      comparison: comparison("listening", summary),
    },
    {
      value: avgStarsValue(summary.avg_stars),
      // No unit beside the dash, since a dash with a unit reads as a measured value of nothing.
      unit: summary.avg_stars === null ? "" : "★ avg",
      label: "How you rated",
      testid: "stats-tile-avg-rating",
      metric: "avg_rating",
      accent: false,
      comparison: comparison("avg_rating", summary),
    },
  ];
}

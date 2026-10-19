import { isNotSharing, type StatsRange, type StatsSummary } from "../../api";

/** The periods in switcher order. */
export const RANGES = [
  "week",
  "month",
  "year",
  "all_time",
] as const satisfies readonly StatsRange[];

export const RANGE_LABELS = {
  week: "Week",
  month: "Month",
  year: "Year",
  all_time: "Lifetime",
} as const satisfies Record<StatsRange, string>;

/** Whether the reader has nothing to show: judged on recorded seconds, not `sessions`, which drops glances. */
export const isEmpty = (
  s: Pick<
    StatsSummary,
    "reading_seconds" | "listening_seconds" | "books_finished"
  >,
) => s.reading_seconds + s.listening_seconds === 0 && s.books_finished === 0;

/** Whether the time-of-day strips have anything to draw; both are zero-filled, so the length can't tell. */
export const hasTimePatterns = (s: Pick<StatsSummary, "hour_of_day">) =>
  s.hour_of_day.some((h) => h.seconds > 0);

/** A count with its digits grouped in threes: "1,234,567". */
export const groupThousands = (n: number) => n.toLocaleString("en-US");

// The server's per-user stats cache lifetime.
const STATS_TTL_SECS = 60;

/** The footer note that reads a just-made change not yet in the figures as expected staleness. */
export const freshnessNote = () =>
  `Stats are accurate to the last ~${STATS_TTL_SECS} seconds.`;

/** Why the page can't show a reader's figures. */
export type Failure =
  | { kind: "not_sharing" }
  | { kind: "other"; message: string };

export function failureOf(error: unknown): Failure {
  if (isNotSharing(error)) return { kind: "not_sharing" };
  return {
    kind: "other",
    message: error instanceof Error ? error.message : String(error),
  };
}

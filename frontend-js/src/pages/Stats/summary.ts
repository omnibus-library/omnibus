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

/** A count with its digits grouped in threes: "1,234,567"; a negative is left plain, as on Dioxus. */
export const groupThousands = (n: number) =>
  n < 0 ? String(n) : n.toLocaleString("en-US");

/** A duration for tooltips and the standouts: "42 m", "3 h", "3 h 20 m". */
export function formatActiveTime(secs: number): string {
  const hours = Math.trunc(secs / 3600);
  const minutes = Math.trunc((secs % 3600) / 60);
  if (hours === 0) return `${minutes} m`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} m`;
}

/** The footer note that reads a just-made change not yet in the figures as expected staleness; 60 is the server's per-user stats cache lifetime. */
export const FRESHNESS_NOTE = "Stats are accurate to the last ~60 seconds.";

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

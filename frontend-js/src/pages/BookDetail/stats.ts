import type { Insights } from "../../api";
import { durationLabel, plural } from "../../format";

/** How many days the spark covers, ending today. */
export const SPARK_DAYS = 22;
const DAY_SECS = 86_400;
const DAY_MS = DAY_SECS * 1000;

// Below this a pace estimate multiplies elapsed time by more than nineteen: a guess dressed as a measurement.
const MIN_PACE_PERCENT = 5;

const count = (n: number, word: string) => `${n} ${word}${plural(n)}`;

export const sessionsLabel = (sessions: number) => count(sessions, "session");

/** The Started tile's sub-label: elapsed days, "today" within the first. */
export function daysIn(now: number, startedAt: number): string {
  const days = Math.max(0, Math.floor((now - startedAt) / DAY_SECS));
  return days === 0 ? "today" : `${count(days, "day")} in`;
}

/** The mean counted sitting. Divides `sittingSeconds`, since `secondsTotal` also holds glances too short to be one. */
export const avgSitSeconds = (i: Insights) =>
  Math.floor(i.sittingSeconds / Math.max(1, i.sessions));

/** "Mar 1": an instant dated on the reader's own calendar. */
export const shortDate = (unixSecs: number) =>
  new Date(unixSecs * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const dayLabel = (day: number) =>
  new Date(day * DAY_MS).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** The time left at the pace so far, from total time and how far in the reader is; none until the pace means something. */
export function pacedSecondsLeft(i: Insights, percent: number): number {
  return Math.floor((i.secondsTotal * (100 - percent)) / percent);
}

const localDay = (unixSecs: number) => {
  const date = new Date(unixSecs * 1000);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
};

/** What a finished book took, `17 days · 13 sessions · 2 highlights`: calendar days from the first sitting to the finish, both counted. */
export function finishTotals(o: {
  startedAt: number;
  finishedAt: number;
  sessions: number;
  highlights: number;
}): string {
  const days = Math.max(1, localDay(o.finishedAt) - localDay(o.startedAt) + 1);
  return [
    count(days, "day"),
    count(o.sessions, "session"),
    o.highlights > 0 && count(o.highlights, "highlight"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The seconds left at the pace so far; `null` below five percent, where it would be a guess, and once the book is done. */
export function pacedLeft(i: Insights, percent: number): number | null {
  if (percent < MIN_PACE_PERCENT || percent >= 100) return null;
  return pacedSecondsLeft(i, percent);
}

/** "≈ 1h 30m to go at your pace · 40% in"; `null` below 5%, where it would be a guess. */
export function timeLeftNote(i: Insights, percent: number): string | null {
  const pct = Math.min(Math.max(percent, 0), 100);
  if (pct >= 100) return "finished — the record is complete";
  if (pct < MIN_PACE_PERCENT) return null;
  return `≈ ${durationLabel(pacedSecondsLeft(i, pct))} to go at your pace · ${pct}% in`;
}

/** `YYYY-MM-DD` as days since the epoch; `null` for a malformed or impossible date such as 2026-02-31. */
function parseDay(raw: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
  return real ? date.getTime() / DAY_MS : null;
}

/** Minutes per day over the last {@link SPARK_DAYS} days, oldest first, anchored on the server's idea of today. */
export function sparkBuckets(
  daily: Insights["daily"],
  asOfDay: string,
): number[] {
  const buckets = new Array<number>(SPARK_DAYS).fill(0);
  const end = parseDay(asOfDay);
  if (end === null) return buckets;
  const start = end - (SPARK_DAYS - 1);
  for (const { day, seconds } of daily) {
    const at = parseDay(day);
    if (at !== null && at >= start && at <= end) {
      buckets[at - start] = Math.floor(seconds / 60);
    }
  }
  return buckets;
}

/** The spark's text alternative: totals and the peak day in a sentence. Ties go to the earliest day. */
export function sparkSummary(
  spark: readonly number[],
  asOfDay: string,
  audioOnly: boolean,
): string {
  const verb = audioOnly ? "listened" : "read";
  const lead = `Minutes ${verb} per day over the last ${count(spark.length, "day")}`;
  const total = spark.reduce((sum, v) => sum + v, 0);
  if (total === 0) return `${lead}: none.`;
  const active = spark.filter((v) => v > 0).length;
  const summary = `${lead}: ${count(total, "minute")} across ${count(active, "day")}`;
  const peak = Math.max(...spark);
  const end = parseDay(asOfDay);
  if (end === null) return `${summary}.`;
  const day = end - (spark.length - 1) + spark.indexOf(peak);
  return `${summary}, most on ${dayLabel(day)} with ${count(peak, "minute")}.`;
}

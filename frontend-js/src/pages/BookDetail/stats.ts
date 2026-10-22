import type { HouseholdActivity, Insights } from "../../api";
import { plural, spacedDuration } from "../../format";

/** How many days the spark covers, ending today. */
export const SPARK_DAYS = 14;
const DAY_SECS = 86_400;
const DAY_MS = DAY_SECS * 1000;

// Below this a pace estimate multiplies elapsed time by more than nineteen: a guess dressed as a measurement.
const MIN_PACE_PERCENT = 5;

const count = (n: number, word: string) => `${n} ${word}${plural(n)}`;

export const sessionsLabel = (sessions: number) => count(sessions, "session");

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

/** The calendar days from a start to a finish, both counted, and at least one. */
export const spanDays = (startedAt: number, finishedAt: number) =>
  Math.max(1, localDay(finishedAt) - localDay(startedAt) + 1);

/** What a finished book took, `17 days · 13 sessions · 2 highlights`: calendar days from the first sitting to the finish, both counted. */
export function finishTotals(o: {
  startedAt: number;
  finishedAt: number;
  sessions: number;
  highlights: number;
}): string {
  return [
    count(spanDays(o.startedAt, o.finishedAt), "day"),
    count(o.sessions, "session"),
    o.highlights > 0 && count(o.highlights, "highlight"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** How fast the reader goes, `About 38 pages an hour`, or `About 12% an hour` without a page count; `null` before five percent, where it would be a guess. */
export function paceLabel(o: {
  insights: Insights;
  percent: number;
  pages: number | null;
}): string | null {
  if (o.percent < MIN_PACE_PERCENT || o.insights.secondsTotal <= 0) return null;
  const hours = o.insights.secondsTotal / 3600;
  const covered = o.pages ? (o.pages * o.percent) / 100 : o.percent;
  const rate = Math.round(covered / hours);
  return o.pages
    ? `About ${rate} page${plural(rate)} an hour`
    : `About ${rate}% an hour`;
}

/** One household reader's time in the book: `Read 2 h 46 m over 3 sessions`, or `Listened` for an audiobook only book. */
export function householdLine(
  activity: HouseholdActivity,
  audioOnly: boolean,
): string {
  const verb = audioOnly ? "Listened" : "Read";
  return `${verb} ${spacedDuration(activity.seconds)} over ${sessionsLabel(activity.sessions)}`;
}

/** A day on the reader's own calendar, `October 12`; the year only when it isn't this one. */
export function calendarDay(now: number, then: number): string {
  const sameYear =
    new Date(then * 1000).getFullYear() === new Date(now * 1000).getFullYear();
  return new Date(then * 1000).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The clock time of an instant, `22:40`. */
export const clockTime = (unixSecs: number) =>
  new Date(unixSecs * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** When something last happened: `Yesterday at 22:40`, `October 12 at 14:30`. */
export function lastActivityLabel(now: number, then: number): string {
  const ago = localDay(now) - localDay(then);
  if (ago === 0) return `Today at ${clockTime(then)}`;
  if (ago === 1) return `Yesterday at ${clockTime(then)}`;
  return `${calendarDay(now, then)} at ${clockTime(then)}`;
}

/** The seconds left at the pace so far; `null` below five percent, where it would be a guess, and once the book is done. */
export function pacedLeft(i: Insights, percent: number): number | null {
  if (percent < MIN_PACE_PERCENT || percent >= 100) return null;
  return pacedSecondsLeft(i, percent);
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

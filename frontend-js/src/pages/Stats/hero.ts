import type { StatsSummary } from "../../api";
import { plural } from "../../format";
import { dayNumber, dayString, streakSpan } from "./calendar";

/** Days of history the spark draws: six weeks, over which a run still reads one bar per day. */
export const SPARK_DAYS = 42;

/** One spark bar: its day, its height as a percentage of the busiest day drawn, and whether it is in the live run. */
export type SparkBar = {
  day: string;
  heightPct: number;
  inStreak: boolean;
  active: boolean;
};

/** The `SPARK_DAYS` days ending at `anchor`; a quiet day keeps its slot, since the gaps are what make a run visible. */
export function buildSpark(
  summary: Pick<StatsSummary, "heatmap" | "current_streak_days">,
  anchor: number,
): SparkBar[] {
  const secondsOn = new Map<number, number>();
  for (const { day, seconds } of summary.heatmap) {
    const n = dayNumber(day);
    if (n !== null) secondsOn.set(n, seconds);
  }
  const start = anchor - (SPARK_DAYS - 1);
  const days = Array.from({ length: SPARK_DAYS }, (_, i) => start + i);
  const busiest = Math.max(0, ...days.map((n) => secondsOn.get(n) ?? 0));
  const active = [...secondsOn].flatMap(([n, s]) => (s > 0 ? [n] : []));
  const run = streakSpan(anchor, active, summary.current_streak_days);
  return days.map((n) => {
    const seconds = secondsOn.get(n) ?? 0;
    return {
      day: dayString(n),
      heightPct:
        busiest <= 0 ? 0 : Math.trunc((Math.max(seconds, 0) * 100) / busiest),
      inStreak: run !== null && n >= run[0] && n <= run[1] && seconds > 0,
      active: seconds > 0,
    };
  });
}

/**
 * The line under the headline: where this run stands against the record. `yours` picks
 * first- or third-person; `null` when there is no record to compare against.
 */
export function streakLine(
  current: number,
  longest: number,
  yours: boolean,
): string | null {
  if (longest <= 0) return null;
  if (current >= longest) {
    return yours
      ? "That is the longest run you have recorded."
      : "That is the longest run on record.";
  }
  const days = `${longest} day${plural(longest)}`;
  return yours
    ? `Your longest ever is ${days}.`
    : `The longest ever is ${days}.`;
}

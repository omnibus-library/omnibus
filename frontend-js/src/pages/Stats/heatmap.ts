import type { StatsSummary } from "../../api";
import {
  civilFromDays,
  dayNumber,
  dayString,
  monthAbbr,
  remEuclid,
  streakSpan,
} from "./calendar";
import { formatActiveTime } from "./summary";

/** Weeks of trailing history the grid draws. */
export const WEEKS = 52;

/** 0 for a quiet day, 1 to 4 for an active one against the grid's busiest. */
export type Level = 0 | 1 | 2 | 3 | 4;

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** Zero maps to 0; anything active gets 1 to 4 relative to the busiest day. */
export function intensity(secs: number, max: number): Level {
  if (secs <= 0 || max <= 0) return 0;
  return LEVELS[Math.min(1 + Math.trunc((secs * 4 - 1) / max), 4)] ?? 4;
}

export type HeatCell = {
  day: string;
  secs: number;
  level: Level;
  /** Days after the anchor in the final week are invisible spacers. */
  future: boolean;
  /** Part of the run the reader is on, which the grid outlines. */
  inStreak: boolean;
};

/** The trailing twelve month labels, ending at `anchor`'s own month. */
export function trailingMonthLabels(anchor: number): string[] {
  const [year, month] = civilFromDays(anchor);
  return Array.from({ length: 12 }, (_, i) =>
    monthAbbr(remEuclid(year * 12 + (month - 1) - (11 - i), 12) + 1),
  );
}

/** The grid's first day: the Monday of `anchor`'s week, 51 weeks back (Unix day 0 is a Thursday). */
const gridStart = (anchor: number) =>
  anchor - remEuclid(anchor + 3, 7) - (WEEKS - 1) * 7;

/**
 * Days with any recorded activity in the window and the share of it they are. The denominator stops at
 * `anchor`, since counting days after today against a reader would report every December as a failure.
 */
export function coverage(
  byDay: ReadonlyMap<number, number>,
  start: number,
  anchor: number,
) {
  const daysRead = [...byDay].filter(
    ([day, secs]) => secs > 0 && day >= start && day <= anchor,
  ).length;
  const elapsed = Math.max(anchor - start + 1, 1);
  return { daysRead, percent: Math.trunc((daysRead * 100) / elapsed) };
}

/** 52 week columns of 7 rows, Monday-first, ending in the week containing `anchor`. */
export function buildCells(
  anchor: number,
  byDay: ReadonlyMap<number, number>,
  max: number,
  streak: readonly [number, number] | null,
): HeatCell[] {
  const start = gridStart(anchor);
  return Array.from({ length: WEEKS * 7 }, (_, i) => {
    const n = start + i;
    const secs = byDay.get(n) ?? 0;
    return {
      day: dayString(n),
      secs,
      level: intensity(secs, max),
      future: n > anchor,
      inStreak: secs > 0 && streak !== null && n >= streak[0] && n <= streak[1],
    };
  });
}

/** A cell's hover title: the time on a day that has some, else the bare day. */
export const cellTitle = ({
  day,
  secs,
  future,
}: Pick<HeatCell, "day" | "secs" | "future">) =>
  !future && secs > 0 ? `${formatActiveTime(secs)} on ${day}` : day;

/** The trailing-year grid with its coverage and month ruler; `null` when there is no day to anchor on. */
export function buildHeatmap(
  summary: Pick<StatsSummary, "as_of_day" | "heatmap" | "current_streak_days">,
) {
  const active = summary.heatmap.flatMap(({ day, seconds }) => {
    const n = dayNumber(day);
    return n === null ? [] : [[n, seconds] as const];
  });
  // The server's clock, else the newest active day, so a missing timestamp still draws a grid.
  const anchor =
    dayNumber(summary.as_of_day) ??
    (active.length > 0 ? Math.max(...active.map(([n]) => n)) : null);
  if (anchor === null) return null;

  const start = gridStart(anchor);
  const byDay = new Map(active.filter(([n]) => n >= start));
  const live = [...byDay].filter(([, secs]) => secs > 0).map(([n]) => n);
  const streak = streakSpan(anchor, live, summary.current_streak_days);
  return {
    cells: buildCells(anchor, byDay, Math.max(0, ...byDay.values()), streak),
    months: trailingMonthLabels(anchor),
    ...coverage(byDay, start, anchor),
  };
}

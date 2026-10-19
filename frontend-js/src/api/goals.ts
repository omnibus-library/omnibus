import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  getPutStatsDailyGoalUrl,
  getPutStatsGoalUrl,
  getStats,
} from "./generated/omnibus";

/** The three reading targets, books this year then pages and minutes a day; `null` is none. */
export type GoalTargets = [number | null, number | null, number | null];

export type DailyGoalKind = "pages" | "minutes";

/** The saved targets, read off the all-time summary, which carries both goals whatever the range. */
export async function fetchGoals(): Promise<GoalTargets> {
  const summary = ok(
    await getStats({
      range: "all_time",
      // Days are cut on the reader's clock (rule 10).
      utc_offset_minutes: -new Date().getTimezoneOffset(),
    }),
  );
  return [
    summary.goal?.target ?? null,
    summary.daily_goals?.pages?.target ?? null,
    summary.daily_goals?.minutes?.target ?? null,
  ];
}

/** A fresh read per visit: the form seeds from it once, so a cached copy would seed it stale. */
export const goalsQuery = queryOptions({
  queryKey: ["goals"],
  queryFn: fetchGoals,
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: 0,
});

/** Sets how many books to finish this year; `null` clears the target and keeps the progress. */
export async function saveAnnualGoal(target: number | null): Promise<void> {
  await send(getPutStatsGoalUrl(), "PUT", { target });
}

/** Sets the pages or minutes a day; `null` clears that target only. */
export async function saveDailyGoal(
  kind: DailyGoalKind,
  target: number | null,
): Promise<void> {
  await send(getPutStatsDailyGoalUrl(), "PUT", { kind, target });
}

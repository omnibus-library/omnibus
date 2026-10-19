import type { ReactNode } from "react";
import type { StatsSummary } from "../../api";
import { plural } from "../../format";
import { dayNumber } from "./calendar";
import { AnnualGoalRing, DailyGoalsCard, GoalsLink } from "./Goal";
import { buildSpark, type SparkBar, streakLine } from "./hero";

// Spelled out so tools/extract-atrium.cjs sees each class.
function sparkBarClass({ inStreak, active }: SparkBar) {
  if (inStreak) return "st-spark-bar on";
  return active ? "st-spark-bar" : "st-spark-bar off";
}

function kicker(current: number, yours: boolean) {
  if (current <= 0) return "No run right now";
  return yours ? "You are on a run" : "On a run";
}

/** The standing hero: the run the reader is on over a six-week spark; `who` names another reader's page. `children` is its first row. */
export function Hero({
  summary,
  who,
  children,
}: {
  summary: StatsSummary;
  who: string | null;
  children: ReactNode;
}) {
  const yours = who === null;
  const current = summary.current_streak_days;
  const anchor = dayNumber(summary.as_of_day);
  const bars = anchor === null ? [] : buildSpark(summary, anchor);
  const line = streakLine(current, summary.longest_streak_days, yours);
  const { goal, daily_goals: daily } = summary;
  const anyGoalSet =
    goal !== null || daily.pages !== null || daily.minutes !== null;
  return (
    <header className="st-hero" data-testid="stats-hero">
      {children}
      <div className="st-hero-inner">
        <div className="st-hero-run">
          {who !== null && (
            <p className="st-hero-who" data-testid="stats-hero-who">
              {who}
            </p>
          )}
          <span className="st-hero-kicker">{kicker(current, yours)}</span>
          <h1 className="st-hero-figure" data-testid="stats-current-streak">
            {current} <span className="st-hero-unit">day{plural(current)}</span>
            <span className="st-hero-stop">.</span>
          </h1>
          {line !== null && (
            <p className="st-hero-line" data-testid="stats-streak-line">
              {line}
            </p>
          )}
          {bars.length > 0 && (
            <>
              <div
                className="st-spark"
                data-testid="stats-spark"
                role="img"
                aria-label="Daily activity over the last six weeks"
              >
                {bars.map((bar) => (
                  <div
                    key={bar.day}
                    className={sparkBarClass(bar)}
                    style={{ height: `${bar.heightPct}%` }}
                    title={bar.day}
                  />
                ))}
              </div>
              <div className="st-spark-axis">
                <span>6 weeks ago</span>
                <span>today</span>
              </div>
            </>
          )}
        </div>
        <div className="st-hero-goals">
          <AnnualGoalRing
            goal={goal}
            finished={summary.books_this_year}
            year={summary.as_of_day.slice(0, 4)}
            asOfDay={summary.as_of_day}
          />
          <DailyGoalsCard daily={daily} />
          {yours && <GoalsLink anySet={anyGoalSet} />}
        </div>
      </div>
    </header>
  );
}

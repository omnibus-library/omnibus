import { Link } from "react-router";
import type { StatsSummary } from "../../api";
import { plural } from "../../format";
import {
  ariaValueNow,
  goalMet,
  goalPercent,
  paceNote,
  progressCaption,
  remainderCaption,
  rowLabel,
} from "./goal";

/** The hero's one goals control: goals are account configuration, set together in Settings. */
export function GoalsLink({ anySet }: { anySet: boolean }) {
  return (
    <Link
      className="st-goals-edit"
      data-testid="stats-goals-link"
      to="/settings?section=goals"
    >
      {anySet ? "Edit goals" : "Set goals"}
    </Link>
  );
}

/**
 * The annual books goal: a ring carrying the ratio, with the figure and pace beside it.
 * Without a target it drops the ring, which only a target can support, and reports the
 * year's real count. `asOfDay` is the server's, and the year is cut from it.
 */
export function AnnualGoalRing({
  goal,
  finished,
  asOfDay,
}: {
  goal: StatsSummary["goal"];
  finished: number | null;
  asOfDay: string;
}) {
  const year = asOfDay.slice(0, 4);
  const pace = goal && paceNote(goal, asOfDay);
  return (
    <div className="st-year" data-testid="stats-goal">
      {goal && (
        <div
          className="st-year-ring"
          style={{ "--st-ring-pct": `${goalPercent(goal)}%` }}
          data-testid="stats-goal-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal.target}
          aria-valuenow={ariaValueNow(goal.current, goal.target)}
          aria-valuetext={progressCaption(goal.current, goal.target, "book")}
          aria-label={`Books finished in ${goal.year}`}
        >
          <div className="st-year-disc">
            <div className="st-year-figure" data-testid="stats-goal-ring">
              {goal.current}
              <span className="st-year-target">/{goal.target}</span>
            </div>
            <div className="st-year-caption">{year} goal</div>
          </div>
        </div>
      )}
      <div className="st-year-side">
        <span className="st-year-kicker">
          {goal ? "This year" : `${year} so far`}
        </span>
        {goal ? (
          <>
            <p className="st-year-line" data-testid="stats-goal-figure">
              {progressCaption(goal.current, goal.target, "book")}
            </p>
            <p className="st-year-note" data-testid="stats-goal-note">
              {remainderCaption(goal.current, goal.target, "book")}
              {pace && <span className="st-year-pace"> · {pace}</span>}
            </p>
          </>
        ) : finished !== null ? (
          <div className="st-year-bare">
            <p
              className="st-year-figure bare"
              data-testid="stats-goal-year-to-date"
            >
              {finished}{" "}
              <span className="st-year-bare-unit">book{plural(finished)}</span>
            </p>
          </div>
        ) : (
          <p className="st-year-invite" data-testid="stats-goal-invite">
            No target for the year yet.
          </p>
        )}
      </div>
    </div>
  );
}

/** One daily goal's row: with a target the ratio and a bar, without one today's bare figure, since a bar is a claim about a target. */
function DailyGoalRow({
  kind,
  noun,
  unit,
  goal,
  today,
  alone,
}: {
  kind: "pages" | "minutes";
  noun: string;
  unit: string;
  goal: StatsSummary["daily_goals"]["pages"];
  today: number | null;
  alone: boolean;
}) {
  const label = rowLabel(noun, goal !== null, alone);
  return (
    <div className="st-daily-row" data-testid={`stats-daily-${kind}`}>
      <div className="st-daily-top">
        <span className="st-daily-label">{label}</span>
      </div>
      {goal ? (
        <>
          <div className="st-daily-figures">
            <p
              className="st-daily-figure"
              data-testid={`stats-daily-${kind}-figure`}
            >
              {progressCaption(goal.current, goal.target, unit)}
            </p>
            <p
              className={goalMet(goal) ? "st-daily-note met" : "st-daily-note"}
              data-testid={`stats-daily-${kind}-note`}
            >
              {remainderCaption(goal.current, goal.target, unit)}
            </p>
          </div>
          <div
            className="st-goal-track"
            data-testid={`stats-daily-${kind}-progress`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={goal.target}
            aria-valuenow={ariaValueNow(goal.current, goal.target)}
            aria-valuetext={progressCaption(goal.current, goal.target, unit)}
            aria-label={`${label} on ${goal.day}`}
          >
            <div
              className={goalMet(goal) ? "st-goal-fill met" : "st-goal-fill"}
              style={{ width: `${goalPercent(goal)}%` }}
            />
          </div>
        </>
      ) : today !== null ? (
        <p
          className="st-daily-figure bare"
          data-testid={`stats-daily-${kind}-today`}
        >
          {today}
        </p>
      ) : (
        <p
          className="st-daily-invite"
          data-testid={`stats-daily-${kind}-invite`}
        >
          No target set.
        </p>
      )}
    </div>
  );
}

/** The standing daily goals card: the pages and minutes rows. */
export function DailyGoalsCard({
  daily,
}: {
  daily: StatsSummary["daily_goals"];
}) {
  // "Every day" promises a recurrence, which is only true once something recurs.
  const neither = daily.pages === null && daily.minutes === null;
  return (
    <div className="st-daily" data-testid="stats-daily-goals">
      <div className="st-daily-head">
        <span className="st-daily-eyebrow">
          {neither ? "Today" : "Every day"}
        </span>
      </div>
      <DailyGoalRow
        kind="pages"
        noun="Pages"
        unit="page"
        goal={daily.pages}
        today={daily.pages_today}
        alone={neither}
      />
      <DailyGoalRow
        kind="minutes"
        noun="Minutes"
        unit="minute"
        goal={daily.minutes}
        today={daily.minutes_today}
        alone={neither}
      />
    </div>
  );
}

import type { StatsSummary } from "../../api";
import {
  buildTicks,
  buildWeekdays,
  clockLine,
  peakHour,
  unzonedNote,
  type Weekday,
  type Weight,
} from "./clock";
import { hasTimePatterns } from "./summary";

// Spelled out so tools/extract-atrium.cjs sees each class.
const TICK_CLASS = {
  hot: "st-clock-tick hot",
  warm: "st-clock-tick warm",
  cool: "st-clock-tick cool",
  idle: "st-clock-tick idle",
} satisfies Record<Weight, string>;

const DAY_BAR_CLASS = {
  hot: "st-day-bar hot",
  warm: "st-day-bar warm",
  idle: "st-day-bar idle",
} satisfies Record<Weekday["weight"], string>;

function ClockBody({ summary }: { summary: StatsSummary }) {
  const line = clockLine(summary.hour_of_day);
  return (
    <div className="st-clock-body">
      <div
        className="st-clock-dial"
        data-testid="stats-clock-dial"
        role="img"
        aria-label="Activity by hour of day"
      >
        {buildTicks(summary.hour_of_day).map((tick) => (
          <div
            key={tick.hour}
            className={TICK_CLASS[tick.weight]}
            style={{
              transform: tick.transform,
              height: `${tick.heightPx}px`,
            }}
          />
        ))}
        <div className="st-clock-hub">
          <div className="st-clock-peak" data-testid="stats-clock-peak">
            {peakHour(summary.hour_of_day)}
          </div>
          <div className="st-clock-peak-label">peak hour</div>
        </div>
      </div>
      <div className="st-clock-side">
        {line !== null && (
          <p className="st-clock-line" data-testid="stats-clock-line">
            {line}
          </p>
        )}
        <div className="st-days" data-testid="stats-when-weekdays">
          {buildWeekdays(summary.day_of_week).map((day) => (
            <div key={day.label} className="st-day">
              <span className="st-day-label">{day.label}</span>
              <div className="st-day-track">
                <div
                  className={DAY_BAR_CLASS[day.weight]}
                  style={{ width: `${day.widthPct}%` }}
                />
              </div>
              <span className="st-day-readout">{day.readout}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Your reading clock": the window's hour-of-day shape as a 24-tick dial, with the weekday split beside it. */
export function ReadingClock({ summary }: { summary: StatsSummary }) {
  const note = unzonedNote(summary.unzoned_seconds);
  return (
    <div className="card st-clock" data-testid="stats-when">
      <div className="label">Your reading clock</div>
      {hasTimePatterns(summary) ? (
        <ClockBody summary={summary} />
      ) : (
        <p className="st-card-empty" data-testid="stats-when-empty">
          No activity with a recorded local time in this period yet.
        </p>
      )}
      {note !== null && (
        <p className="st-card-note" data-testid="stats-when-unzoned">
          {note}
        </p>
      )}
    </div>
  );
}

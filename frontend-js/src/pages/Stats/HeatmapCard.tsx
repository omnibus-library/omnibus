import type { StatsSummary } from "../../api";
import { plural } from "../../format";
import { buildHeatmap, cellTitle, type Level } from "./heatmap";

// Spelled out so tools/extract-atrium.cjs sees each class.
const CELL_CLASS = {
  0: "st-hm-cell st-hm-0",
  1: "st-hm-cell st-hm-1",
  2: "st-hm-cell st-hm-2",
  3: "st-hm-cell st-hm-3",
  4: "st-hm-cell st-hm-4",
} satisfies Record<Level, string>;

const RUN_CELL_CLASS = {
  0: "st-hm-cell st-hm-0 run",
  1: "st-hm-cell st-hm-1 run",
  2: "st-hm-cell st-hm-2 run",
  3: "st-hm-cell st-hm-3 run",
  4: "st-hm-cell st-hm-4 run",
} satisfies Record<Level, string>;

const LEGEND_LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** The trailing-year grid with the live run outlined, the days-read coverage and the streak record in its header; the run the reader is on is the hero's to state. */
export function HeatmapCard({ summary }: { summary: StatsSummary }) {
  const heat = buildHeatmap(summary);
  // Without a day to anchor on the card holds its space rather than drawing days it would have to invent.
  if (heat === null) {
    return <div className="card st-card-placeholder" aria-hidden="true" />;
  }
  const longest = summary.longest_streak_days;
  return (
    <div className="card st-heat" data-testid="stats-heatmap">
      <div className="st-heat-head">
        <div>
          <div className="label">Every day of the last year</div>
          <div className="st-heat-sub">
            Darker is longer. Your current run is outlined.
          </div>
        </div>
        <div className="st-heat-figures">
          <div className="st-heat-figure" data-testid="stats-days-read">
            <div className="st-heat-value">{heat.daysRead}</div>
            <div className="label">days read</div>
          </div>
          <div className="st-heat-figure">
            <div className="st-heat-value">
              {heat.percent}
              <span className="st-heat-value-unit">%</span>
            </div>
            <div className="label">of the year</div>
          </div>
          <div className="st-heat-figure" data-testid="stats-longest-streak">
            <div className="st-heat-value accent">
              {longest}
              <span className="st-heat-value-unit">{` day${plural(longest)}`}</span>
            </div>
            {/* "best run", never "best runs": the figure is how long the record run was, not how many there were. */}
            <div className="label">best run</div>
          </div>
        </div>
      </div>
      <div className="st-heatmap-scroll">
        <div
          className="st-heatmap"
          role="img"
          aria-label="Daily reading activity, trailing year"
        >
          {heat.cells.map((cell) => (
            <div
              key={cell.day}
              className={
                cell.future
                  ? "st-hm-cell st-hm-future"
                  : (cell.inStreak ? RUN_CELL_CLASS : CELL_CLASS)[cell.level]
              }
              title={cellTitle(cell)}
            />
          ))}
        </div>
      </div>
      <div className="st-hm-months" aria-hidden="true">
        {heat.months.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>
      <div className="st-hm-legend" aria-hidden="true">
        <span>less</span>
        {LEGEND_LEVELS.map((level) => (
          <div key={level} className={CELL_CLASS[level]} />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}

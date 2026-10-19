import type { StatsSummary } from "../../api";
import { averageLabel, buildBars, type MonthBar } from "./monthly";

// Spelled out so tools/extract-atrium.cjs sees each class.
function columnClass(bar: MonthBar, peak: number) {
  if (bar.current) return "st-mo-col current";
  return peak > 0 && bar.books === peak ? "st-mo-col peak" : "st-mo-col";
}

/** The trailing-12-month books-finished chart with its per-month average; the busiest month is called out beside the current one, or a tall bar mid-year is just tall. */
export function MonthlyChart({ summary }: { summary: StatsSummary }) {
  const months = summary.books_per_month;
  if (months.length === 0) {
    return <div className="card st-card-placeholder" aria-hidden="true" />;
  }
  const bars = buildBars(months);
  const peak = Math.max(...bars.map((bar) => bar.books));
  return (
    <div className="card st-monthly" data-testid="stats-monthly-chart">
      <div className="st-monthly-head">
        <div className="label">Books finished · trailing 12 months</div>
        <div className="st-monthly-avg">{averageLabel(months)}</div>
      </div>
      <div
        className="st-monthly-bars"
        role="img"
        aria-label="Books finished per month, trailing 12 months"
      >
        {bars.map((bar, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the twelve columns are positional
            key={i}
            className={columnClass(bar, peak)}
            data-testid="stats-monthly-bar"
            title={`${bar.books} finished`}
          >
            <div className="st-mo-count">{bar.books}</div>
            <div className="st-mo-track">
              <div
                className="st-mo-bar"
                style={{ height: `${bar.heightPct}%` }}
              />
            </div>
            <div className="st-mo-label">{bar.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

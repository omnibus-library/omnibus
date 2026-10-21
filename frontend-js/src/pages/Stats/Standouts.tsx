import type { StatsSummary } from "../../api";
import { buildRows, FASTEST_READ_NOTE } from "./superlatives";

/** "The standouts": the window's single most-X figures as a card grid, or nothing, since the page already has an empty state one level up. */
export function StandoutsGrid({ summary }: { summary: StatsSummary }) {
  const rows = buildRows(summary);
  if (rows.length === 0) return null;
  return (
    <div className="st-standouts" data-testid="stats-superlatives">
      {rows.map((row, i) => (
        <div
          key={row.label}
          // The leading standout carries the accent tint, so a ranked grid gives a reader somewhere to start.
          className={i === 0 ? "st-standout lead" : "st-standout"}
          data-testid="stats-superlative"
        >
          <div className="st-standout-label">{row.label}</div>
          <div className="st-standout-headline">{row.headline}</div>
          <div className="st-standout-detail">{row.detail}</div>
        </div>
      ))}
      {summary.superlatives.fastest_read !== null && (
        <p className="st-standouts-note" data-testid="stats-superlatives-note">
          {FASTEST_READ_NOTE}
        </p>
      )}
    </div>
  );
}

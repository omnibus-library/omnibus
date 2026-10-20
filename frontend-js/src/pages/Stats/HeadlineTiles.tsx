import type { StatsSummary } from "../../api";
import { VS_LABELS } from "./drillIn";
import { buildTiles, type Direction, type Metric, type Tile } from "./tiles";

// Spelled out so tools/extract-atrium.cjs sees each class.
const DELTA_CLASS = {
  up: "st-tile-delta up",
  down: "st-tile-delta down",
  flat: "st-tile-delta flat",
} as const satisfies Record<Direction, string>;

/** What the tile shows, then the action, since an `aria-label` replaces the visible text a screen reader would read. */
function tileName(tile: Tile, vs: string) {
  const figure = tile.unit === "" ? tile.value : `${tile.value} ${tile.unit}`;
  const against = tile.comparison ? `, ${tile.comparison.label} ${vs}` : "";
  return `${tile.label}: ${figure}${against}. Expand details`;
}

/**
 * The four-tile headline row. Each tile is a button that opens its metric's drill-in.
 * The face shows the comparison and the sheet shows the trend and caveats.
 */
export function HeadlineTiles({
  summary,
  onOpen,
}: {
  summary: StatsSummary;
  onOpen: (metric: Metric) => void;
}) {
  return (
    <div className="st-tiles">
      {buildTiles(summary).map((tile) => (
        <button
          key={tile.testid}
          type="button"
          className={tile.accent ? "st-tile accent" : "st-tile"}
          data-testid={tile.testid}
          aria-label={tileName(tile, VS_LABELS[summary.range])}
          onClick={() => onOpen(tile.metric)}
        >
          <div className="st-tile-top">
            {/* Keyed on the value so a period switch remounts just this node, replaying the content swap while the tile stays put. */}
            <span key={tile.value} className="st-tile-value">
              {tile.value}
            </span>
            {/* Omitted rather than empty, because the row is a flex with a gap and an empty span would still push the delta across. */}
            {tile.unit !== "" && (
              <span className="st-tile-unit">{tile.unit}</span>
            )}
            {tile.comparison && (
              <span
                className={DELTA_CLASS[tile.comparison.direction]}
                data-testid={`${tile.testid}-delta`}
              >
                {tile.comparison.label}
              </span>
            )}
          </div>
          <div className="st-tile-label">{tile.label}</div>
          {tile.comparison && (
            <div className="st-tile-track">
              <div
                className="st-tile-fill"
                style={{ width: `${tile.comparison.fillPct}%` }}
              />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

import { Fragment, useState } from "react";
import type { ChartResult } from "../../api";
import { fixed } from "../../format";
import { MEASURES, seriesLabel } from "./chart";
import {
  axisMax,
  bucketLabel,
  bucketTitle,
  lineRuns,
  PAD_L,
  PAD_T,
  plotGeometry,
  stackOffsets,
  tickLabel,
  VIEW_H,
  VIEW_W,
  valueLabel,
} from "./plot";

// Share of a bucket's band the bars take, the rest being the gutter between buckets; a band past
// CROWDED_BARS slots takes the wider share, so six grouped bars don't come out as hairlines.
const BAR_SHARE = 0.68;
const WIDE_BAR_SHARE = 0.88;
const CROWDED_BARS = 2;
// The surface gap between two bars sharing a band, halved once a slot is too narrow to spare it.
const BAR_GAP = 2;
const NARROW_SLOT = 7;
const MAX_X_LABELS = 12;
// Entrance stagger per bucket, capped so a wide chart still settles quickly.
const STAGGER_MS = 18;
const STAGGER_CAP_MS = 320;
// Past this share of the width the hover card flips to the other side of the cursor.
const TIP_FLIP_PCT = 55;
// Gridlines for a result that names none; the wire allows zero, and zero would divide by it.
const FALLBACK_DIVISIONS = 4;

// Spelled out so tools/extract-atrium.cjs sees each class.
const SERIES_CLASSES = ["cb-s0", "cb-s1", "cb-s2", "cb-s3", "cb-s4", "cb-s5"];

/** The class that colours series `index`, wrapping once the palette runs out. */
const seriesClass = (index: number) =>
  SERIES_CLASSES[index % SERIES_CLASSES.length] ?? "cb-s0";

/** The legend under the chart: one swatch per series, marked with its axis when there are two. */
export function ChartLegend({ result }: { result: ChartResult }) {
  const dual = result.axes.length > 1;
  return (
    <ul className="cb-legend" data-testid="chart-legend">
      {result.series.map((series, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: a split repeats a measure, so the position is the series
          key={i}
          className="cb-legend-row"
        >
          <span
            className={`cb-legend-swatch ${seriesClass(i)}`}
            data-mark={series.mark}
          />
          <span className="cb-legend-name">{seriesLabel(series)}</span>
          {dual && (
            <span className="cb-legend-axis">
              {series.axis === 0 ? "left" : "right"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The plotted numbers as a real, openable table: three light-mode series colours sit under 3:1, and this is the relief for it. */
export function ChartTable({ result }: { result: ChartResult }) {
  return (
    <details className="cb-table-wrap" data-testid="chart-table">
      <summary className="cb-table-toggle">Show the numbers</summary>
      <table className="cb-table">
        <caption>Chart data</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {result.series.map((series, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a split repeats a measure, so the position is the series
              <th key={i} scope="col">
                {seriesLabel(series)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.buckets.map((key, b) => (
            <tr key={key}>
              <th scope="row">{bucketLabel(key, result.bucket)}</th>
              {result.series.map((series, i) => {
                const value = series.values[b];
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a split repeats a measure, so the position is the series
                  <td key={i}>
                    {typeof value === "number" ? valueLabel(value) : "no data"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** The hovered bucket's readout: every series at once, so a reader can compare them without measuring heights against two scales. */
function ChartHoverCard({
  result,
  index,
}: {
  result: ChartResult;
  index: number;
}) {
  const key = result.buckets[index];
  if (key === undefined) return null;
  // A share of the plot's width, as the SVG stretches to its container and this is HTML laid over it.
  const pct = (plotGeometry(result).bandCentre(index) / VIEW_W) * 100;
  return (
    <div
      className={pct > TIP_FLIP_PCT ? "cb-tip is-flipped" : "cb-tip"}
      data-testid="chart-tooltip"
      role="status"
      style={{ left: `${fixed(pct, 2)}%` }}
    >
      <p className="cb-tip-head">{bucketTitle(key, result.bucket)}</p>
      <ul className="cb-tip-rows">
        {result.series.map((series, idx) => {
          const value = series.values[index];
          // A stacked zero draws no segment, so listing it describes something that isn't on screen.
          if (result.stacked && value === 0) return null;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a series' position is its identity, as in the legend
            <li key={idx} className="cb-tip-row">
              <span className={`cb-tip-swatch ${seriesClass(idx)}`} />
              <span className="cb-tip-name">{seriesLabel(series)}</span>
              <span className="cb-tip-value">
                {typeof value === "number"
                  ? `${valueLabel(value)} ${MEASURES[series.measure].unit}`
                  : "no data"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One SVG drawing whatever result it is handed, with no chart library so the marks take the page's own tokens. `onBrush` gets the first and last bucket a drag covered; the page decides whether that is a zoom. */
export function ChartPlot({
  result,
  onBrush,
}: {
  result: ChartResult;
  onBrush: (first: number, last: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const plot = plotGeometry(result);
  // A series' position is its identity: a split repeats the measure, and a genre may be called "Other".
  const placed = result.series.map((series, idx) => ({ series, idx }));
  const bars = placed.filter(({ series }) => series.mark === "bar");
  const lines = placed.filter(({ series }) => series.mark === "line");
  // Stacked bars share one slot per bucket; grouped ones split the band.
  const slots = result.stacked ? 1 : bars.length;
  const barZone =
    plot.bandW * (slots > CROWDED_BARS ? WIDE_BAR_SHARE : BAR_SHARE);
  const barW = slots === 0 ? 0 : barZone / slots;
  const barGap = barW < NARROW_SLOT ? BAR_GAP / 2 : BAR_GAP;
  const offsets = result.stacked
    ? stackOffsets(
        result,
        bars.map((bar) => bar.idx),
      )
    : [];
  const divisions =
    result.divisions === 0 ? FALLBACK_DIVISIONS : result.divisions;
  const labelStep = Math.max(
    Math.ceil(result.buckets.length / MAX_X_LABELS),
    1,
  );
  const leftMax = result.axes[0]?.max ?? 1;
  const rightMax = result.axes[1]?.max;
  const summary = result.series.map(seriesLabel).join(", ");

  return (
    <div className="cb-plot">
      <svg
        className="cb-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Chart of ${summary} over ${result.buckets.length} periods`}
        preserveAspectRatio="none"
        onMouseLeave={() => {
          setHovered(null);
          // A drag that leaves the plot is abandoned, not committed to wherever the pointer exited.
          setDragStart(null);
        }}
        onMouseUp={() => setDragStart(null)}
      >
        {[...Array(divisions + 1).keys()].map((step) => {
          const frac = step / divisions;
          const y = PAD_T + plot.plotH * (1 - frac);
          return (
            <Fragment key={step}>
              <line
                className="cb-grid"
                x1={PAD_L}
                x2={VIEW_W - plot.padR}
                y1={fixed(y, 1)}
                y2={fixed(y, 1)}
              />
              <text
                className="cb-tick cb-tick-left"
                x={PAD_L - 10}
                y={fixed(y + 4, 1)}
                textAnchor="end"
              >
                {tickLabel(leftMax * frac)}
              </text>
              {rightMax !== undefined && (
                <text
                  className="cb-tick cb-tick-right"
                  x={VIEW_W - plot.padR + 10}
                  y={fixed(y + 4, 1)}
                  textAnchor="start"
                >
                  {tickLabel(rightMax * frac)}
                </text>
              )}
            </Fragment>
          );
        })}

        {hovered !== null && (
          <rect
            className="cb-band"
            x={fixed(plot.bandCentre(hovered) - plot.bandW / 2, 1)}
            y={PAD_T}
            width={fixed(plot.bandW, 1)}
            height={fixed(plot.plotH, 1)}
          />
        )}

        {dragStart !== null && hovered !== null && (
          <rect
            className="cb-brush"
            x={fixed(
              plot.bandCentre(Math.min(dragStart, hovered)) - plot.bandW / 2,
              1,
            )}
            y={PAD_T}
            width={fixed(plot.bandW * (Math.abs(hovered - dragStart) + 1), 1)}
            height={fixed(plot.plotH, 1)}
          />
        )}

        {bars.map(({ series, idx }, slot) => {
          const max = axisMax(result, series);
          return (
            <g key={idx} className={`cb-bars ${seriesClass(idx)}`}>
              {result.buckets.map((key, i) => {
                const value = series.values[i];
                if (typeof value !== "number") return null;
                // A stacked bar starts on the running total beneath it; a grouped one starts at zero in its own lane.
                const base = offsets[slot]?.[i] ?? 0;
                const top = plot.y(base + value, max);
                const x =
                  plot.bandCentre(i) -
                  barZone / 2 +
                  barW * (result.stacked ? 0 : slot) +
                  barGap / 2;
                const dim = hovered !== null && hovered !== i;
                return (
                  <rect
                    key={key}
                    className={dim ? "cb-bar is-dim" : "cb-bar"}
                    x={fixed(x, 1)}
                    y={fixed(top, 1)}
                    width={fixed(Math.max(barW - barGap, 1), 1)}
                    height={fixed(Math.max(plot.y(base, max) - top, 0), 1)}
                    rx="3"
                    style={{
                      "--cb-delay": `${Math.min(i * STAGGER_MS, STAGGER_CAP_MS)}ms`,
                    }}
                  />
                );
              })}
            </g>
          );
        })}

        {lines.map(({ series, idx }) => {
          const max = axisMax(result, series);
          return (
            <g key={idx} className={`cb-line ${seriesClass(idx)}`}>
              {lineRuns(plot, series, max).map((run) => (
                <Fragment key={run.path}>
                  <path className="cb-area" d={run.area} />
                  <path className="cb-stroke" d={run.path} />
                </Fragment>
              ))}
              {result.buckets.map((key, i) => {
                const value = series.values[i];
                if (typeof value !== "number") return null;
                const on = hovered === i;
                return (
                  <circle
                    key={key}
                    className={on ? "cb-dot is-on" : "cb-dot"}
                    cx={fixed(plot.bandCentre(i), 1)}
                    cy={fixed(plot.y(value, max), 1)}
                    r={on ? "5.5" : "4"}
                  />
                );
              })}
            </g>
          );
        })}

        <line
          className="cb-axis"
          x1={PAD_L}
          x2={VIEW_W - plot.padR}
          y1={fixed(plot.baseline, 1)}
          y2={fixed(plot.baseline, 1)}
        />
        {result.buckets.map((key, i) => {
          // A thinned-out label reappears while its bucket is hovered, so the pointer always has one to read.
          if (i % labelStep !== 0 && hovered !== i) return null;
          return (
            <text
              key={key}
              className={hovered === i ? "cb-xlabel is-on" : "cb-xlabel"}
              x={fixed(plot.bandCentre(i), 1)}
              y={fixed(plot.baseline + 20, 1)}
              textAnchor="middle"
            >
              {bucketLabel(key, result.bucket)}
            </text>
          );
        })}

        {/* One full-height target per bucket, above everything: a short bar shouldn't have to be hit, and the card reads every series anyway. */}
        {result.buckets.map((key, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: the hover is a pointer aid; the legend and the table carry the same numbers
          <rect
            key={key}
            className="cb-hit"
            x={fixed(plot.bandCentre(i) - plot.bandW / 2, 1)}
            y={PAD_T}
            width={fixed(plot.bandW, 1)}
            height={fixed(plot.plotH, 1)}
            onMouseEnter={() => setHovered(i)}
            onMouseDown={() => setDragStart(i)}
            onMouseUp={() => {
              if (dragStart !== null) {
                onBrush(dragStart, i);
                // A drag across buckets zooms and re-lays the plot, so the hovered index would name a bucket the pointer isn't over.
                if (dragStart !== i) setHovered(null);
              }
              setDragStart(null);
            }}
          />
        ))}
      </svg>
      {hovered !== null && <ChartHoverCard result={result} index={hovered} />}
    </div>
  );
}

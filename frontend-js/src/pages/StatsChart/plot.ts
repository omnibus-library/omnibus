import type { ChartBucket, ChartResult, ChartSeries } from "../../api";
import { fixed } from "../../format";
import { monthAbbr } from "../Stats/calendar";

// The plot's labels and geometry, a port of `chart_builder/plot.rs`.

// A key's `i`th dash-separated part as a whole number, `null` when it isn't one.
function part(key: string, i: number): number | null {
  const raw = key.split("-")[i];
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
}

const isMonth = (m: number | null): m is number =>
  m !== null && m >= 1 && m <= 12;

/** A bucket key on the x-axis; a key it can't parse stands for itself rather than taking the page down. */
export function bucketLabel(key: string, bucket: ChartBucket): string {
  switch (bucket) {
    case "year":
      return key;
    case "month": {
      const [year, month] = [part(key, 0), part(key, 1)];
      if (year === null || !isMonth(month)) return key;
      // The year rides along on January, so a multi-year axis doesn't repeat it twelve times.
      return month === 1
        ? `${monthAbbr(month)} ${year % 100}`
        : monthAbbr(month);
    }
    case "day":
    case "week": {
      const [month, day] = [part(key, 1), part(key, 2)];
      return isMonth(month) && day !== null
        ? `${day} ${monthAbbr(month)}`
        : key;
    }
    default: {
      const _exhaustive: never = bucket;
      return _exhaustive;
    }
  }
}

/** The full bucket name for the hover card, which has room for the year the axis label drops. */
export function bucketTitle(key: string, bucket: ChartBucket): string {
  switch (bucket) {
    case "month": {
      const [year, month] = [part(key, 0), part(key, 1)];
      return year !== null && isMonth(month)
        ? `${monthAbbr(month)} ${year}`
        : key;
    }
    case "week":
      return `Week of ${bucketLabel(key, bucket)}`;
    default:
      return bucketLabel(key, bucket);
  }
}

/** A plotted value, for the hover card and the data table. */
export function valueLabel(value: number): string {
  return Math.abs(value % 1) < 0.05 || value >= 100
    ? String(Math.round(value))
    : fixed(value, 1);
}

/** An axis tick, trimmed to the precision the magnitude deserves. */
export function tickLabel(value: number): string {
  if (value >= 100 || Math.abs(value % 1) < Number.EPSILON) {
    return String(Math.round(value));
  }
  return fixed(value, value >= 10 ? 0 : 1);
}

// The logical drawing surface: the SVG scales to its container, so these are the only coordinates the geometry deals in.
export const VIEW_W = 760;
export const VIEW_H = 340;
export const PAD_T = 14;
const PAD_B = 46;
export const PAD_L = 56;
// Room for the last bar not to sit flush against the edge, and for a second axis's labels.
export const PAD_R_SINGLE = 18;
export const PAD_R_DUAL = 56;

/** Where a result's marks land in view coordinates. */
export function plotGeometry(result: Pick<ChartResult, "axes" | "buckets">) {
  const padR = result.axes.length > 1 ? PAD_R_DUAL : PAD_R_SINGLE;
  const plotH = VIEW_H - PAD_T - PAD_B;
  const bandW = (VIEW_W - PAD_L - padR) / Math.max(result.buckets.length, 1);
  return {
    padR,
    plotH,
    bandW,
    baseline: PAD_T + plotH,
    bandCentre: (i: number) => PAD_L + bandW * (i + 0.5),
    /** `value` on an axis of `max`, clamped so one overshooting its axis still lands in the frame. */
    y: (value: number, max: number) =>
      PAD_T +
      plotH * (1 - (max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0)),
  };
}

export type PlotGeometry = ReturnType<typeof plotGeometry>;

type Point = { x: number; y: number };

const point = ({ x, y }: Point) => `${fixed(x, 1)},${fixed(y, 1)}`;

const pairs = <T>(items: readonly T[]) =>
  items.flatMap((a, i) => {
    const b = items[i + 1];
    return b === undefined ? [] : [[a, b] as const];
  });

/**
 * A monotone-cubic path through `pts`, the interpolation `d3.curveMonotoneX` uses: it can't
 * overshoot, so the curve never draws past the data. Two points are a straight segment.
 */
export function monotonePath(pts: readonly Point[]): string {
  const [first, second] = pts;
  if (first === undefined || second === undefined) return "";
  if (pts.length === 2) return `M${point(first)} L${point(second)}`;

  const secants = pairs(pts).map(([a, b]) => {
    const dx = b.x - a.x;
    return Math.abs(dx) < Number.EPSILON ? 0 : (b.y - a.y) / dx;
  });
  // Fritsch-Carlson tangents: zero at every local extremum, which is what keeps the curve inside the data's range.
  const tangents = pts.map((_, i) => {
    const [a, b] = [secants[i - 1], secants[i]];
    if (a === undefined) return b ?? 0;
    if (b === undefined) return a;
    if (a * b <= 0) return 0;
    // Clamped to three times the shallower secant, so a steep neighbour can't drag the curve past the point it passes through.
    const limit = 3 * Math.min(Math.abs(a), Math.abs(b));
    return Math.min(Math.max((a + b) / 2, -limit), limit);
  });

  let d = `M${point(first)}`;
  for (const [i, [from, to]] of pairs(pts).entries()) {
    const dx = to.x - from.x;
    const c1 = {
      x: from.x + dx / 3,
      y: from.y + ((tangents[i] ?? 0) * dx) / 3,
    };
    const c2 = {
      x: to.x - dx / 3,
      y: to.y - ((tangents[i + 1] ?? 0) * dx) / 3,
    };
    d += ` C${point(c1)} ${point(c2)} ${point(to)}`;
  }
  return d;
}

/** One unbroken stretch of a line series: its path, and the same closed down to the baseline as a soft wash. */
type LineRun = { path: string; area: string };

/**
 * The runs of present values as curved paths. A gap breaks the line rather than bridging it: an average
 * with no data in a bucket is unknown, and drawing through would assert a value never measured.
 */
export function lineRuns(
  plot: PlotGeometry,
  series: ChartSeries,
  max: number,
): LineRun[] {
  const runs: Point[][] = [[]];
  for (const [i, value] of series.values.entries()) {
    if (value === null) runs.push([]);
    else runs.at(-1)?.push({ x: plot.bandCentre(i), y: plot.y(value, max) });
  }
  return runs.flatMap((pts) => {
    const [head] = pts;
    const tail = pts.at(-1);
    // A single point can't be a path; its dot carries it.
    if (head === undefined || tail === undefined || pts.length < 2) return [];
    const path = monotonePath(pts);
    const floor = fixed(plot.baseline, 1);
    return [
      {
        path,
        area: `${path} L${fixed(tail.x, 1)},${floor} L${fixed(head.x, 1)},${floor} Z`,
      },
    ];
  });
}

/** The max of the axis a series is scaled against, the left one when a result names an axis it did not send. */
export const axisMax = (result: ChartResult, series: ChartSeries) =>
  (result.axes[series.axis] ?? result.axes[0])?.max ?? 1;

/**
 * The running total beneath each stacked bar, per series per bucket. An absent value adds nothing:
 * the bar above it sits lower rather than the column gaining a hole.
 */
export function stackOffsets(
  result: ChartResult,
  barIndices: readonly number[],
): number[][] {
  const running = result.buckets.map(() => 0);
  return barIndices.map((idx) => {
    const base = [...running];
    for (const b of running.keys()) {
      running[b] = (running[b] ?? 0) + (result.series[idx]?.values[b] ?? 0);
    }
    return base;
  });
}

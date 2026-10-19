import type { ChartResult } from "../../api";
import { fitAxes } from "./chart";

// A zoom is held as bucket keys, never indices: regroup monthly to weekly and index 3 is another week, where
// a key that has left the axis stops resolving and the zoom drops itself. It only narrows the buckets already fetched.

/** The fewest buckets a brush may select: one is a click, and zooming to it would leave a single bar filling the frame. */
const MIN_BRUSH_BUCKETS = 2;

/** A zoom, as the first and last bucket key it spans. */
export type ZoomRange = readonly [first: string, last: string];

/** The inclusive indices a zoom spans in `buckets`, or `null` when either key has left the axis or the span is one bucket. */
export function resolve(
  buckets: readonly string[],
  [first, last]: ZoomRange,
): [number, number] | null {
  const [start, end] = [buckets.indexOf(first), buckets.indexOf(last)];
  if (start === -1 || end === -1) return null;
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return hi > lo ? [lo, hi] : null;
}

/** `result` narrowed to `range` with its axes refitted to the slice; untouched when the range doesn't resolve, so a stale zoom shows the full chart. */
export function apply(
  result: ChartResult,
  range: ZoomRange | null,
): ChartResult {
  const span = range && resolve(result.buckets, range);
  if (!span) return result;
  const [lo, hi] = span;
  const series = result.series.map((s) => ({
    ...s,
    values: s.values.slice(lo, hi + 1),
  }));
  const buckets = result.buckets.slice(lo, hi + 1);
  // Refitted, not inherited: an axis sized for the whole range leaves a zoomed-in quiet stretch flat on the floor.
  const { axes, divisions } = fitAxes(series, result.stacked, buckets.length);
  return { ...result, buckets, series, axes, divisions };
}

/** The keys a brush from bucket `a` to `b` selects, or `null` when the span is too short to be more than a click. */
export function brushRange(
  buckets: readonly string[],
  a: number,
  b: number,
): ZoomRange | null {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const [first, last] = [buckets[lo], buckets[hi]];
  if (hi - lo + 1 < MIN_BRUSH_BUCKETS) return null;
  return first !== undefined && last !== undefined ? [first, last] : null;
}

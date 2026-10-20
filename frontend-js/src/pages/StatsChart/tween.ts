import { useEffect, useRef, useState } from "react";
import type { ChartResult, ChartSeries } from "../../api";

// Values are interpolated, never geometry, so bars, dots and the line move from one mechanism. Axes snap,
// as a lerped maximum moves its tick labels through 3.7 and 7.4. Marks match by identity (a series by
// measure and slice, a value by bucket key), as a positional blend would interpolate March into April.

// At FRAME_MS apiece, STEPS frames are the whole duration.
const STEPS = 22;
const FRAME_MS = 16;
// Past this many buckets the motion costs more than it is worth, since the bars are a pixel wide anyway.
const MAX_TWEEN_BUCKETS = 120;

/** Ease-out cubic, matching the `--cb-ease` curve the entrance animation uses. */
export function easeOut(t: number): number {
  const inv = 1 - Math.min(Math.max(t, 0), 1);
  return 1 - inv * inv * inv;
}

const sameSeries = (a: ChartSeries, b: ChartSeries) =>
  a.measure === b.measure && (a.slice ?? null) === (b.slice ?? null);

/** The value `series` held in the bucket keyed `key` in `from`, if it held one. */
function priorValue(from: ChartResult, series: ChartSeries, key: string) {
  const at = from.buckets.indexOf(key);
  return from.series.find((s) => sameSeries(s, series))?.values[at] ?? null;
}

/** `from` and `to` blended at `t`, on `to`'s axes. A mark new in `to` grows in from the baseline, as on a first paint; one absent from `to` just vanishes. */
export function blend(
  from: ChartResult,
  to: ChartResult,
  t: number,
): ChartResult {
  const e = easeOut(t);
  return {
    ...to,
    series: to.series.map((series) => ({
      ...series,
      values: series.values.map((target, b) => {
        const key = to.buckets[b];
        if (target === null || key === undefined) return target;
        const start = priorValue(from, series, key) ?? 0;
        return start + (target - start) * e;
      }),
    })),
  };
}

/**
 * A view of `target` that animates to each new value. The first result and any over 120 buckets show
 * at once; until a tween's first frame renders the previous frame stays, and a newer result takes over
 * a running tween from the frame it had reached.
 */
export function useTweened(target: ChartResult | null): ChartResult | null {
  const [shown, setShown] = useState<ChartResult | null>(null);
  const onScreen = useRef<ChartResult | null>(null);

  useEffect(() => {
    const show = (frame: ChartResult | null) => {
      onScreen.current = frame;
      setShown(frame);
    };
    const from = onScreen.current;
    if (target === from) return;
    if (
      target === null ||
      from === null ||
      target.buckets.length > MAX_TWEEN_BUCKETS
    ) {
      show(target);
      return;
    }
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      show(blend(from, target, step / STEPS));
      if (step === STEPS) clearInterval(timer);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [target]);

  // A cleared target clears the view, so an error can't leave a stale chart standing.
  return target === null ? null : (shown ?? target);
}

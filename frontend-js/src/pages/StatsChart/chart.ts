import type {
  ChartAxis,
  ChartBucket,
  ChartMeasure,
  ChartResult,
  ChartSeries,
  ChartSpec,
  ChartUnit,
} from "../../api";

// The chart builder's vocabulary, a port of `shared/src/chart.rs`. The server decides which
// specs it will draw; the picker uses the same rules, so it never offers one it would refuse.

type Grain = "sitting" | "ledger" | "completion" | "rating";
type Aggregate = "count" | "sum" | "average";

type MeasureInfo = {
  label: string;
  unit: ChartUnit;
  grain: Grain;
  aggregate: Aggregate;
  description: string;
};

/** What a measure counts, where it comes from and how it aggregates; a new server measure is a compile error here. */
export const MEASURES = {
  books_finished: {
    label: "Books finished",
    unit: "books",
    grain: "completion",
    aggregate: "count",
    description:
      "Books you marked finished — counted once each, however you marked them.",
  },
  avg_page_length: {
    label: "Avg book length",
    unit: "pages",
    grain: "completion",
    aggregate: "average",
    description: "How long those finished books were, averaged.",
  },
  avg_rating: {
    label: "Avg rating",
    unit: "stars",
    grain: "rating",
    aggregate: "average",
    description: "Stars you gave, averaged over the books you rated.",
  },
  reading_minutes: {
    label: "Reading minutes",
    unit: "minutes",
    grain: "sitting",
    aggregate: "sum",
    description: "Time with an ebook open.",
  },
  listening_minutes: {
    label: "Listening minutes",
    unit: "minutes",
    grain: "sitting",
    aggregate: "sum",
    description: "Time with an audiobook playing.",
  },
  session_count: {
    label: "Sittings",
    unit: "sessions",
    grain: "sitting",
    aggregate: "count",
    description: "Sittings — a glance too short to count is left out.",
  },
  avg_session_minutes: {
    label: "Avg sitting length",
    unit: "minutes",
    grain: "sitting",
    aggregate: "average",
    description: "How long a typical sitting ran.",
  },
  pages_read: {
    label: "Pages read",
    unit: "pages",
    grain: "ledger",
    aggregate: "sum",
    description: "Ground covered, from how far through each book you got.",
  },
} satisfies Record<ChartMeasure, MeasureInfo>;

/** Why two measures can't be summed: what each row of its table is. */
export const GRAIN_LABELS = {
  sitting: "per sitting",
  ledger: "per day read",
  completion: "per book finished",
  rating: "per rating",
} satisfies Record<Grain, string>;

export const BUCKET_LABELS = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
} satisfies Record<ChartBucket, string>;

/** The most y-scales one chart may carry. */
export const MAX_AXES = 2;

/** No measures: opening on a chart invites a reader to accept it, and an empty one greys nothing out. */
export const DEFAULT_SPEC: ChartSpec = {
  measures: [],
  bucket: "month",
  range: "year",
  breakdown: "none",
};

/** The distinct units on a chart, in the order their first measure was chosen, which is the order they claim axes in. */
export function specUnits(spec: ChartSpec): ChartUnit[] {
  return [...new Set(spec.measures.map((m) => MEASURES[m].unit))];
}

/** The axis `measure` would be drawn against, or `null` when both are already claimed by other units. */
export function axisFor(spec: ChartSpec, measure: ChartMeasure): 0 | 1 | null {
  const units = specUnits(spec);
  const at = units.indexOf(MEASURES[measure].unit);
  const axis = at === -1 ? units.length : at;
  return axis === 0 || axis === 1 ? axis : null;
}

/** Whether `measure` can join: not already on the chart, and its unit has an axis or can claim the free one. */
export const canAdd = (spec: ChartSpec, measure: ChartMeasure) =>
  !spec.measures.includes(measure) && axisFor(spec, measure) !== null;

/** Whether a genre can split `measure`: a genre belongs to a book, so only per-book measures qualify. */
export const supportsBreakdown = (measure: ChartMeasure) =>
  MEASURES[measure].grain === "completion";

/**
 * Adds or removes `measure`, keeping selection order, as the first chosen owns the left axis. Adding one
 * that can't join does nothing. A split survives only while one splittable measure is left to describe.
 */
export function toggle(spec: ChartSpec, measure: ChartMeasure): ChartSpec {
  let next = spec.measures;
  if (spec.measures.includes(measure)) {
    next = spec.measures.filter((m) => m !== measure);
  } else if (canAdd(spec, measure)) {
    next = [...spec.measures, measure];
  }
  const [only, ...rest] = next;
  const keepsSplit =
    only !== undefined && rest.length === 0 && supportsBreakdown(only);
  return {
    ...spec,
    measures: next,
    breakdown: keepsSplit ? spec.breakdown : "none",
  };
}

/** The legend entry: the measure, qualified by its slice when split. */
export function seriesLabel(series: ChartSeries): string {
  const { label } = MEASURES[series.measure];
  return typeof series.slice === "string"
    ? `${label} · ${series.slice}`
    : label;
}

/** The largest value in a series, or `null` when every bucket is empty. */
export function seriesMax(series: ChartSeries): number | null {
  const present = series.values.filter((v) => v !== null);
  return present.length === 0 ? null : Math.max(...present);
}

/** Whether there is nothing to draw: no buckets, or every series empty in every bucket. */
export const resultIsEmpty = (result: ChartResult) =>
  result.buckets.length === 0 ||
  result.series.every((s) => s.values.every((v) => v === null));

/** Rounds a tick step up to a readable 1 / 2 / 2.5 / 5 × 10ⁿ value. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return ([1, 2, 2.5, 5].find((step) => normalized <= step) ?? 10) * magnitude;
}

// How much of the axis the data must fill before a fit is accepted; rounding only the maximum up leaves a peak of 550 on a 1000 axis.
const AXIS_MAX_HEADROOM = 1.35;
const DEFAULT_DIVISIONS = 4;
const AXIS_DIVISION_CHOICES = [DEFAULT_DIVISIONS, 5, 3];
// Below this peak a whole-number axis gets one gridline per unit.
const SMALL_COUNT_MAX = 6;

/** One gridline's worth of value, rounded up to a whole number on a count axis. */
function axisStep(max: number, divisions: number, integral: boolean): number {
  const step = niceStep(max / divisions);
  return integral ? Math.ceil(step) : step;
}

/** An axis maximum and the gridline count that divides it, so the ticks land on round numbers and the data fills the frame. */
export function niceAxis(
  max: number,
  integral: boolean,
): { max: number; divisions: number } {
  if (!Number.isFinite(max) || max <= 0) {
    return { max: 1, divisions: DEFAULT_DIVISIONS };
  }
  if (integral && max <= SMALL_COUNT_MAX) {
    const top = Math.max(Math.ceil(max), 1);
    return { max: top, divisions: top };
  }
  for (const divisions of AXIS_DIVISION_CHOICES) {
    const top = axisStep(max, divisions, integral) * divisions;
    if (top >= max && top <= max * AXIS_MAX_HEADROOM) {
      return { max: top, divisions };
    }
  }
  // No tick count fits inside the headroom: take the default's ceiling rather than overflow the axis.
  return {
    max: axisStep(max, DEFAULT_DIVISIONS, integral) * DEFAULT_DIVISIONS,
    divisions: DEFAULT_DIVISIONS,
  };
}

/** An axis maximum on a fixed gridline count: both axes share one set of gridlines, so the right can't pick its own. */
export function axisMaxOn(
  max: number,
  divisions: number,
  integral: boolean,
): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  return axisStep(max, divisions, integral) * divisions;
}

/**
 * The one or two axes `series` are scaled against, and the gridline count they share. A zoom re-runs it
 * over its slice, as the server does for the whole window, so the scale can't shift under the reader.
 */
export function fitAxes(
  series: readonly ChartSeries[],
  stacked: boolean,
  buckets: number,
): { axes: ChartAxis[]; divisions: number } {
  const on = (axis: number) => series.filter((s) => s.axis === axis);
  // A stacked axis has to clear the tallest column, not the tallest slice.
  const peak = (axis: number) =>
    stacked
      ? Math.max(
          0,
          ...Array.from({ length: buckets }, (_, b) =>
            on(axis).reduce((sum, s) => sum + (s.values[b] ?? 0), 0),
          ),
        )
      : Math.max(0, ...on(axis).map((s) => seriesMax(s) ?? 0));
  // An axis is whole-numbered only when every series on it counts rows.
  const integral = (axis: number) =>
    on(axis).length > 0 &&
    on(axis).every((s) => MEASURES[s.measure].aggregate === "count");

  const left = niceAxis(peak(0), integral(0));
  const axes: ChartAxis[] = [];
  for (const axis of [0, 1]) {
    const first = on(axis)[0];
    if (!first) continue;
    axes.push({
      unit: MEASURES[first.measure].unit,
      max:
        axis === 0
          ? left.max
          : axisMaxOn(peak(axis), left.divisions, integral(axis)),
    });
  }
  return { axes, divisions: left.divisions };
}

/** Each measure's unit, and whether it plots as a bar (a total) or a line (a mean). */
const MEASURES = {
  books_finished: { unit: "books", bar: true },
  avg_page_length: { unit: "pages", bar: false },
  pages_read: { unit: "pages", bar: true },
  avg_rating: { unit: "stars", bar: false },
  reading_minutes: { unit: "minutes", bar: true },
  listening_minutes: { unit: "minutes", bar: true },
  avg_session_minutes: { unit: "minutes", bar: false },
  session_count: { unit: "sessions", bar: true },
} as const;

type Measure = keyof typeof MEASURES;

/** What the picker posts to `/api/rpc/chart-series`, trimmed to what the stub reads. */
export type ChartSpec = {
  measures: Measure[];
  bucket: string;
  breakdown: string;
};

const STUB_GENRES = ["Fantasy", "Horror", "Crime"];

function stubBuckets(bucket: string): string[] {
  if (bucket === "year") return ["2024", "2025", "2026"];
  if (bucket === "day")
    return Array.from({ length: 8 }, (_, i) => `2026-08-0${i + 1}`);
  if (bucket === "week")
    return ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"];
  return Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}`);
}

/**
 * A well-formed answer for `spec` that echoes it, so the page's own reactions
 * (a second scale, a stacked split, a regrouped axis) are driven by the picker.
 * What the server computes is `db::stats::builder`'s to test.
 */
export function buildChartResult(spec: ChartSpec): unknown {
  const buckets = stubBuckets(spec.bucket);
  const value = (i: number, seed: number) => 1 + ((i + seed) % 4);
  const [only] = spec.measures;

  if (
    spec.breakdown === "genre" &&
    only !== undefined &&
    spec.measures.length === 1
  ) {
    return {
      bucket: spec.bucket,
      buckets,
      series: STUB_GENRES.map((genre, genreIndex) => ({
        measure: only,
        slice: genre,
        axis: 0,
        mark: MEASURES[only].bar ? "bar" : "line",
        values: buckets.map((_, i) => value(i, genreIndex)),
      })),
      axes: [{ unit: MEASURES[only].unit, max: 20 }],
      divisions: 4,
      // Slices of an additive measure are parts of a whole; means never stack.
      stacked: MEASURES[only].bar,
      truncated: false,
      caveats: [],
    };
  }

  const units = [...new Set(spec.measures.map((m) => MEASURES[m].unit))];
  return {
    bucket: spec.bucket,
    buckets,
    series: spec.measures.map((m, seriesIndex) => ({
      measure: m,
      slice: null,
      axis: units.indexOf(MEASURES[m].unit),
      mark: MEASURES[m].bar ? "bar" : "line",
      values: buckets.map((_, i) => value(i, seriesIndex)),
    })),
    axes: units.map((unit) => ({ unit, max: 20 })),
    divisions: 4,
    stacked: false,
    truncated: false,
    // `pages_read` is the one measure whose coverage is bounded.
    caveats: spec.measures.includes("pages_read")
      ? [
          "Pages read is measured from the progress ledger, which only covers reading recorded after it was introduced. Earlier buckets read low.",
        ]
      : [],
  };
}

import type { ChartResult } from "../../api";
import { seriesLabel } from "./chart";
import { bucketLabel, valueLabel } from "./plot";

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

import { Fragment } from "react";
import type { ChartResult } from "../../api";
import { GRAIN_LABELS, MEASURES } from "./chart";
import {
  availabilityNote,
  emptyNote,
  MAX_BUCKETS,
  scalesNote,
  splitNote,
  zoomNote,
} from "./notes";

/** Under the chart: what it shows, how the scales work, why some measures are greyed out, and what the numbers can't tell you. */
export function ChartNotes({ result }: { result: ChartResult }) {
  if (result.series.length === 0) return null;
  // A split repeats its measure once per slice, and its sentence six times would be noise.
  const measures = [...new Set(result.series.map((s) => s.measure))];
  const scales = scalesNote(result);
  const split = splitNote(result);
  const empty = emptyNote(result);
  return (
    <details className="cb-notes" data-testid="chart-notes">
      <summary className="cb-notes-toggle">What this chart shows</summary>
      <div className="cb-notes-body">
        <dl className="cb-notes-measures">
          {measures.map((m) => {
            const { label, description, grain, unit } = MEASURES[m];
            return (
              <Fragment key={m}>
                <dt className="cb-notes-term">{label}</dt>
                <dd className="cb-notes-def">
                  {description} Measured {GRAIN_LABELS[grain]}, in {unit}.
                </dd>
              </Fragment>
            );
          })}
        </dl>
        {scales && (
          <p className="cb-notes-line" data-testid="chart-notes-scales">
            {scales}
          </p>
        )}
        <p className="cb-notes-line" data-testid="chart-notes-availability">
          {availabilityNote(result)}
        </p>
        {split && <p className="cb-notes-line">{split}</p>}
        {empty && <p className="cb-notes-line">{empty}</p>}
        <p className="cb-notes-line" data-testid="chart-notes-zoom">
          {zoomNote(result)}
        </p>
        {result.caveats.length > 0 && (
          <>
            <p className="cb-notes-head">What these numbers can't tell you</p>
            <ul className="cb-notes-caveats">
              {result.caveats.map((caveat) => (
                <li key={caveat} data-testid="chart-caveat">
                  {caveat}
                </li>
              ))}
            </ul>
          </>
        )}
        {result.truncated && (
          <p className="cb-notes-line" data-testid="chart-truncated">
            The range runs longer than this axis can draw, so only the most
            recent {MAX_BUCKETS} periods are shown.
          </p>
        )}
      </div>
    </details>
  );
}

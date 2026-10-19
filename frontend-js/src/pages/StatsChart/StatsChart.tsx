import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ChartBucket,
  ChartMeasure,
  type ChartSpec,
  chartQuery,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { RANGE_LABELS, RANGES } from "../Stats/summary";
import { ChartLegend, ChartPlot, ChartTable } from "./ChartPlot";
import {
  BUCKET_LABELS,
  canAdd,
  DEFAULT_SPEC,
  GRAIN_LABELS,
  MAX_AXES,
  MEASURES,
  resultIsEmpty,
  specUnits,
  supportsBreakdown,
  toggle,
} from "./chart";
import "./StatsChart.css";

/** The option of `options` whose value is `raw`; a select's change event hands back a bare string. */
const choose = <T extends string>(options: readonly T[], raw: string) =>
  options.find((option) => option === raw);

function scalesHint(units: number) {
  if (units === 0) {
    return "Nothing plotted yet — anything in the list can join.";
  }
  return units < MAX_AXES
    ? "One scale in use — anything else can still join."
    : "Both scales in use. Measures in other units are greyed out until you free one.";
}

type ControlsProps = { spec: ChartSpec; onChange: (spec: ChartSpec) => void };

/** The picker: each control writes one field of the spec, and any write refetches. */
function ChartControls({ spec, onChange }: ControlsProps) {
  // A split describes one measure's population, so it needs exactly one.
  const solo = spec.measures.length === 1 ? spec.measures[0] : undefined;
  return (
    <section className="cb-controls" data-testid="chart-controls">
      <fieldset className="cb-measures" data-testid="chart-measures">
        <legend>Measures</legend>
        <div className="cb-measure-list">
          {ChartMeasure.options.map((m) => {
            const on = spec.measures.includes(m);
            const { label, unit, grain } = MEASURES[m];
            return (
              <div key={m} className={on ? "cb-measure is-on" : "cb-measure"}>
                <input
                  id={`cb-m-${m}`}
                  type="checkbox"
                  checked={on}
                  disabled={!on && !canAdd(spec, m)}
                  onChange={() => onChange(toggle(spec, m))}
                />
                <label htmlFor={`cb-m-${m}`}>{label}</label>
                <span className="cb-measure-meta">
                  {unit} · {GRAIN_LABELS[grain]}
                </span>
              </div>
            );
          })}
        </div>
        <p className="cb-hint" data-testid="chart-scales">
          {scalesHint(specUnits(spec).length)}
        </p>
      </fieldset>

      <div className="cb-fields">
        <div className="cb-field">
          <label htmlFor="cb-bucket">Group by</label>
          <select
            id="cb-bucket"
            className="cb-select"
            value={spec.bucket}
            onChange={(e) => {
              const bucket = choose(ChartBucket.options, e.target.value);
              if (bucket) onChange({ ...spec, bucket });
            }}
          >
            {ChartBucket.options.map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABELS[b]}
              </option>
            ))}
          </select>
        </div>

        <div className="cb-field">
          <label htmlFor="cb-range">Period</label>
          <select
            id="cb-range"
            className="cb-select"
            value={spec.range}
            onChange={(e) => {
              const range = choose(RANGES, e.target.value);
              if (range) onChange({ ...spec, range });
            }}
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="cb-field">
          <label htmlFor="cb-breakdown">Split</label>
          <select
            id="cb-breakdown"
            className="cb-select"
            // A split needs one measure, and one that belongs to a book, so the control says why it is unavailable.
            disabled={solo === undefined || !supportsBreakdown(solo)}
            value={spec.breakdown ?? "none"}
            onChange={(e) =>
              onChange({
                ...spec,
                breakdown: e.target.value === "genre" ? "genre" : "none",
              })
            }
          >
            <option value="none">No split</option>
            <option value="genre">By genre</option>
          </select>
          <span className="cb-hint">
            {solo === undefined
              ? "one measure only"
              : supportsBreakdown(solo)
                ? "top genres, rest folded"
                : "only per-book measures split"}
          </span>
        </div>
      </div>
    </section>
  );
}

/** The chart for one spec. The last chart stays, dimmed, while the next loads; only the first load blanks the surface. */
function ChartCanvas({ spec }: { spec: ChartSpec }) {
  const chart = useQuery({
    ...chartQuery(spec),
    placeholderData: keepPreviousData,
  });
  if (chart.isError) {
    return (
      <PageError
        message={chart.error.message}
        backTo="/stats"
        backLabel="Back to your stats"
      />
    );
  }
  if (chart.data === undefined) {
    return <Loading kind="page" label="Drawing the chart" />;
  }
  const busy = chart.isFetching;
  return (
    <section
      className={
        busy ? "cb-canvas ld-stale is-stale is-loading" : "cb-canvas ld-stale"
      }
      aria-busy={busy}
      data-testid="chart-canvas"
    >
      {resultIsEmpty(chart.data) ? (
        <p className="cb-empty" data-testid="chart-empty">
          Nothing recorded in this period yet. Try a wider period, or a measure
          you've got data for.
        </p>
      ) : (
        <>
          <ChartPlot result={chart.data} />
          <ChartLegend result={chart.data} />
          <ChartTable result={chart.data} />
        </>
      )}
    </section>
  );
}

/** `/stats/chart`: compose a chart from the closed vocabulary of measures, and read it back. */
export function StatsChart() {
  const [spec, setSpec] = useState<ChartSpec>(DEFAULT_SPEC);
  return (
    <div className="cb-page" data-testid="chart-builder">
      <PageTitle page="Chart builder" />
      <header className="cb-masthead">
        <h1 className="cb-title">Chart builder</h1>
        <p className="cb-sub">
          Pick what to plot. Every measure is computed over its own table and
          lined up on a shared time bucket, so two that count different things
          can still share an axis.
        </p>
      </header>
      <ChartControls spec={spec} onChange={setSpec} />
      {spec.measures.length === 0 ? (
        <p className="cb-prompt" data-testid="chart-prompt">
          Nothing plotted yet — tick a measure above and it'll appear here.
        </p>
      ) : (
        <ChartCanvas spec={spec} />
      )}
    </div>
  );
}

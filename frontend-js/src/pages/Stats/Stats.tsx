import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  type HouseholdReader,
  householdReadersQuery,
  parseUserId,
  type StatsRange,
  type StatsSummary,
  statsQuery,
  type UserId,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { windowLabel } from "./calendar";
import { Hero } from "./Hero";
import { heading, viewing } from "./picker";
import {
  type Failure,
  failureOf,
  freshnessNote,
  isEmpty,
  RANGE_LABELS,
  RANGES,
} from "./summary";
import "./Stats.css";

/** A reader's figures can't be shown; another reader's page returns to the caller's own. */
function StatsFailure({
  failure,
  other,
}: {
  failure: Failure;
  other: boolean;
}) {
  const refused = failure.kind === "not_sharing";
  const message = refused
    ? "This reader isn't sharing their stats"
    : failure.message;
  return refused || other ? (
    <PageError
      message={message}
      backTo="/stats"
      backLabel="Back to your stats"
    />
  ) : (
    <PageError message={message} />
  );
}

function StatsEmpty({ whoName }: { whoName: string | null }) {
  return (
    <div className="card st-empty" data-testid="stats-empty">
      <h3 className="st-empty-title">No reading activity yet</h3>
      <p className="st-empty-sub">
        {whoName === null
          ? "Open a book or start an audiobook and your stats will begin to fill in."
          : `${whoName} hasn't tracked any reading yet.`}
      </p>
    </div>
  );
}

/** Everything the period pills govern, under one label and one boundary. */
function WindowBand({
  range,
  onRange,
  period,
}: {
  range: StatsRange;
  onRange: (range: StatsRange) => void;
  period: StatsSummary | undefined;
}) {
  return (
    <section className="st-band" data-testid="stats-period-section">
      <div className="st-band-head" data-testid="stats-window-head">
        <div className="st-band-heading">
          <span className="st-band-kicker">In this window</span>
          <span className="st-band-window" data-testid="stats-window-label">
            {period ? windowLabel(range, period.as_of_day) : ""}
          </span>
        </div>
        <div className="st-band-rule st-band-rule-accent" />
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the st-ranges rules never reset */}
        <div className="st-ranges" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={r === range ? "st-range-pill on" : "st-range-pill"}
              data-testid={`stats-range-${r}`}
              aria-pressed={r === range}
              onClick={() => onRange(r)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      {period ? (
        <div className="st-band-body" />
      ) : (
        <div className="card st-card-placeholder">
          <Loading
            kind="section"
            testId="stats-window-loading"
            label="Tallying this window"
          />
        </div>
      )}
    </section>
  );
}

/** What the pills don't govern: nothing under this label moves when they do. */
function StandingBand() {
  return (
    <section className="st-band" data-testid="stats-alltime-section">
      <div className="st-band-head st-band-head-plain">
        <div className="st-band-heading">
          <span className="st-band-kicker st-band-kicker-quiet">
            Outside the window
          </span>
        </div>
        <div className="st-band-rule" />
      </div>
      <div className="st-band-body" />
    </section>
  );
}

/** One viewed reader's figures. Keyed on the reader, so a switch drops the previous reader's state. */
function ReaderStats({
  userId,
  range,
  onRange,
  readers,
}: {
  userId: UserId | null;
  range: StatsRange;
  onRange: (range: StatsRange) => void;
  readers: HouseholdReader[] | undefined;
}) {
  const standing = useQuery(statsQuery("all_time", userId));
  // The previous window stays on screen while the next one loads.
  const period = useQuery({
    ...statsQuery(range, userId),
    placeholderData: keepPreviousData,
  });

  // A picker that pops in after the page has settled reads as content shifting, so wait for the list too.
  if (standing.isPending || readers === undefined) {
    return <Loading kind="page" label="Tallying your reading" />;
  }
  const who = viewing(userId, readers);
  if (standing.isError || period.isError) {
    return (
      <StatsFailure
        failure={failureOf(standing.error ?? period.error)}
        other={who.kind === "reader"}
      />
    );
  }

  return (
    <div className="st-page">
      <PageTitle page="Stats" />
      <Hero summary={standing.data} who={heading(who)} />
      <div className="st-body">
        {isEmpty(standing.data) ? (
          <StatsEmpty whoName={who.kind === "reader" ? who.name : null} />
        ) : (
          <div className="st-scope" data-testid="stats-scope-user">
            <WindowBand range={range} onRange={onRange} period={period.data} />
            <StandingBand />
          </div>
        )}
        <p className="st-footnote" data-testid="stats-freshness-note">
          {freshnessNote()}
        </p>
      </div>
    </div>
  );
}

/** `/stats`: one reader's reading, a window the pills choose and a standing band they don't. */
export function Stats() {
  const userId = parseUserId(useSearchParams()[0].get("user"));
  const [range, setRange] = useState<StatsRange>("month");
  const readers = useQuery(householdReadersQuery);
  return (
    <ReaderStats
      key={userId ?? "you"}
      userId={userId}
      range={range}
      onRange={setRange}
      readers={readers.data}
    />
  );
}

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  fetchRecentProgress,
  type HouseholdReader,
  householdReadersQuery,
  type LibraryComposition,
  type LibrarySize,
  libraryCompositionQuery,
  librarySizeQuery,
  parseUserId,
  type ResumePoint,
  type StatsRange,
  type StatsSummary,
  statsQuery,
  type UserId,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { InProgressCard, RecentlyFinishedCard } from "./BooksNow";
import { CompositionPanels } from "./CompositionPanels";
import { windowLabel } from "./calendar";
import { DrillInSheet } from "./DrillInSheet";
import { GenreDonut } from "./GenreDonut";
import { HeadlineTiles } from "./HeadlineTiles";
import { HeatmapCard } from "./HeatmapCard";
import { LibrarySizeHero } from "./LibrarySize";
import { MonthlyChart } from "./MonthlyChart";
import { heading, viewing } from "./picker";
import { ReaderPicker } from "./ReaderPicker";
import { ReadingClock } from "./ReadingClock";
import { IN_PROGRESS_SHOWN } from "./readingNow";
import { ShareStatsToggle } from "./ShareStatsToggle";
import { StandoutsGrid } from "./Standouts";
import { StatsHero } from "./StatsHero";
import {
  type Failure,
  failureOf,
  freshnessNote,
  isEmpty,
  RANGE_LABELS,
  RANGES,
} from "./summary";
import type { Metric } from "./tiles";
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

/** The metric whose sheet is open, with the summary it was opened on. */
type OpenMetric = { metric: Metric; summary: StatsSummary };

/** Everything the period pills govern, under one label and one boundary. */
function WindowBand({
  range,
  onRange,
  period,
  onOpen,
}: {
  range: StatsRange;
  onRange: (range: StatsRange) => void;
  period: StatsSummary | undefined;
  onOpen: (open: OpenMetric) => void;
}) {
  return (
    <section className="st-band" data-testid="stats-period-section">
      <div className="st-band-head" data-testid="stats-window-head">
        <div className="st-band-heading">
          <span className="st-band-kicker">In this window</span>
          <span className="st-band-window" data-testid="stats-window-label">
            {period ? windowLabel(period.range, period.as_of_day) : ""}
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
        <div className="st-band-body">
          <HeadlineTiles
            summary={period}
            onOpen={(metric) => onOpen({ metric, summary: period })}
          />
          <div className="st-duo">
            <ReadingClock summary={period} />
            <GenreDonut summary={period} />
          </div>
          <StandoutsGrid summary={period} />
        </div>
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
function StandingBand({
  summary,
  openBooks,
}: {
  summary: StatsSummary;
  openBooks: ResumePoint[];
}) {
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
      <div className="st-band-body">
        <HeatmapCard summary={summary} />
        <div className="st-duo">
          <InProgressCard books={openBooks} summary={summary} />
          <RecentlyFinishedCard books={summary.finished_books} />
        </div>
        <MonthlyChart summary={summary} />
      </div>
    </section>
  );
}

/** Whose figures the page shows: the reader's own, or the shelf's. The period pills govern every user figure and no library one, so a third tab would split one governed set in half. */
type Scope = "user" | "library";

function ScopeTab({
  name,
  blurb,
  testId,
  on,
  onPick,
}: {
  name: string;
  blurb: string;
  testId: string;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? "st-mode on" : "st-mode"}
      data-testid={testId}
      aria-pressed={on}
      onClick={onPick}
    >
      <span className="st-mode-name">{name}</span>
      <span className="st-mode-blurb">{blurb}</span>
    </button>
  );
}

/** The User / Library switch, so the reader always knows which scope the figures below belong to. */
function ScopeSwitch({
  scope,
  onScope,
}: {
  scope: Scope;
  onScope: (scope: Scope) => void;
}) {
  return (
    <div className="st-modes" data-testid="stats-scope-switch">
      <div className="st-modes-inner">
        <ScopeTab
          name="User"
          blurb="Your reading, this period"
          testId="stats-scope-tab-user"
          on={scope === "user"}
          onPick={() => onScope("user")}
        />
        <ScopeTab
          name="Library"
          blurb="The shelf itself"
          testId="stats-scope-tab-library"
          on={scope === "library"}
          onPick={() => onScope("library")}
        />
        {scope === "library" && (
          <span className="st-modes-note">Whole shelf · not period-scoped</span>
        )}
      </div>
    </div>
  );
}

/** The library's reads, fetched once per page: they describe the shelf, so neither the pills nor a reader switch can change them. `undefined` until they land. */
type LibraryReads = {
  size: LibrarySize | undefined;
  composition: LibraryComposition | undefined;
};

/** One viewed reader's figures. Keyed on the reader, so a switch drops the previous reader's state. */
function ReaderStats({
  userId,
  range,
  onRange,
  scope,
  onScope,
  readers,
  library,
}: {
  userId: UserId | null;
  range: StatsRange;
  onRange: (range: StatsRange) => void;
  scope: Scope;
  onScope: (scope: Scope) => void;
  readers: HouseholdReader[] | undefined;
  library: LibraryReads;
}) {
  const [open, setOpen] = useState<OpenMetric | null>(null);
  const standing = useQuery(statsQuery("all_time", userId));
  // One past what the card lists, so it can tell a cut list from a whole one; a failed read is no open books.
  const openBooks = useQuery({
    queryKey: ["stats-open-books", userId],
    queryFn: () =>
      fetchRecentProgress(IN_PROGRESS_SHOWN + 1, userId).catch(() => []),
    refetchOnWindowFocus: false,
  });
  // The previous window stays on screen while the next one loads.
  const period = useQuery({
    ...statsQuery(range, userId),
    placeholderData: keepPreviousData,
  });

  // Waits for the picker's list too, or it pops in after the page has settled and reads as content shifting; and for the open books, or "Nothing open right now." shows before the answer.
  if (standing.isPending || openBooks.isPending || readers === undefined) {
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
      <StatsHero summary={standing.data} who={heading(who)}>
        <div className="st-hero-bar">
          <ReaderPicker readers={readers} selected={userId} />
          {who.kind === "you" && <ShareStatsToggle />}
        </div>
      </StatsHero>
      <ScopeSwitch scope={scope} onScope={onScope} />
      <div className="st-body">
        {isEmpty(standing.data) ? (
          <StatsEmpty whoName={who.kind === "reader" ? who.name : null} />
        ) : scope === "library" ? (
          <div className="st-scope" data-testid="stats-scope-library">
            <LibrarySizeHero size={library.size} />
            <CompositionPanels composition={library.composition} />
          </div>
        ) : (
          <div className="st-scope" data-testid="stats-scope-user">
            <WindowBand
              range={range}
              onRange={onRange}
              period={period.data}
              onOpen={setOpen}
            />
            <StandingBand
              summary={standing.data}
              openBooks={openBooks.data ?? []}
            />
          </div>
        )}
        <p className="st-footnote" data-testid="stats-freshness-note">
          {freshnessNote()}
        </p>
      </div>
      {open && (
        <DrillInSheet
          metric={open.metric}
          summary={open.summary}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** `/stats`: one reader's reading, a window the pills choose and a standing band they don't, or the shelf itself. */
export function Stats() {
  const userId = parseUserId(useSearchParams()[0].get("user"));
  const [range, setRange] = useState<StatsRange>("month");
  const [scope, setScope] = useState<Scope>("user");
  const readers = useQuery(householdReadersQuery);
  const size = useQuery(librarySizeQuery);
  const composition = useQuery(libraryCompositionQuery);
  return (
    <ReaderStats
      key={userId ?? "you"}
      userId={userId}
      range={range}
      onRange={setRange}
      scope={scope}
      onScope={setScope}
      readers={readers.data}
      library={{ size: size.data, composition: composition.data }}
    />
  );
}

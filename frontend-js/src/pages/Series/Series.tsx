import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from "react-router";
import {
  parseSeriesId,
  type SeriesId,
  type SeriesReading,
  type SeriesSummary,
  seriesListQuery,
  seriesReadingQuery,
} from "../../api";
import {
  ListBody,
  type ListCopy,
  ListHead,
  type Preview,
  previewOf,
  type ReadingState,
  RowBar,
  readingStateOf,
  useRevealShown,
} from "../../components/Browse/BrowseList";
import { listPhase } from "../../components/Browse/browseOrder";
import { Loading } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  useScrollRestore,
  useScrollRestoreOnChange,
} from "../../scrollRestore";
import { loadDiscoveryPrefs, saveDiscoverySort } from "../../viewPrefs";
import { SeriesPane } from "../SeriesDetail/SeriesPane";
import {
  bySeries,
  computeSeriesGroups,
  defaultSeries,
  firstLetter,
  type ReadingMap,
  rowLabel,
} from "./seriesOrder";
import "./Series.css";

/** Said when no series has a book: the library may hold standalones only. */
const NO_SERIES = "No series yet — no book in the library belongs to one.";

const COPY: ListCopy = {
  title: "Series",
  noun: "series",
  testid: "series",
  filterPlaceholder: "Filter by name or author…",
  filterLabel: "Filter series by name or author",
  nameSort: "A–Z",
  empty: NO_SERIES,
};

const NO_SERIES_ROWS: SeriesSummary[] = [];

function SeriesRow({
  series,
  progress,
  state,
  shown,
  current,
}: {
  series: SeriesSummary;
  progress: SeriesReading | undefined;
  state: ReadingState;
  shown: boolean;
  current: boolean;
}) {
  return (
    <Link
      to={`/series/${series.id}`}
      className={shown ? "au-row se-row is-shown" : "au-row se-row"}
      style={{ "--au-accent": series.accent ?? "var(--accent)" }}
      aria-current={current ? "page" : undefined}
      aria-label={rowLabel(series, progress)}
      data-testid="series-card"
    >
      <span className="se-row-text">
        <span className="au-row-name se-row-name">{series.name}</span>
        {series.primaryAuthor !== null && (
          <span className="se-row-author">{series.primaryAuthor}</span>
        )}
      </span>
      <RowBar
        count={series.bookCount}
        progress={progress}
        state={state}
        testid="series-row-bar"
      />
      <span className="au-row-count">{series.bookCount}</span>
    </Link>
  );
}

/** List + pane for both series routes; the list keeps its filter, sort and scroll while the pane changes. */
export function Series() {
  const { id } = useParams();
  const routed = parseSeriesId(id);
  const series = useQuery(seriesListQuery);
  const reading = useQuery(seriesReadingQuery);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState(() => loadDiscoveryPrefs().series_sort);
  const [onlyReading, setOnlyReading] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const pathname = useLocation().pathname;
  useScrollRestore(series.data !== undefined, pathname);
  useScrollRestoreOnChange(pathname);

  const rows = series.data ?? NO_SERIES_ROWS;
  const readingState = readingStateOf(reading);
  const progress = useMemo<ReadingMap | null>(
    () => (reading.data ? bySeries(reading.data) : null),
    [reading.data],
  );
  const groups = useMemo(
    () =>
      computeSeriesGroups(rows, {
        text: filter,
        sort,
        reading: progress,
        onlyReading,
      }),
    [rows, filter, sort, progress, onlyReading],
  );

  const phase = listPhase({
    isPending: series.isPending,
    isError: series.isError,
    hasRows: rows.length > 0,
  });
  const preview = useMemo(
    () => previewOf(phase, readingState, () => defaultSeries(rows, progress)),
    [rows, phase, readingState, progress],
  );
  const shown = routed ?? (preview.kind === "item" ? preview.id : null);
  const readingCount = progress
    ? [...progress.values()].filter((r) => r.reading > 0).length
    : null;
  const total = phase === "loading" || phase === "failed" ? null : rows.length;
  // Recent orders by progress, so it has no order to show until that lands.
  const waiting =
    phase === "loading" || (sort === "recent" && readingState === "pending");
  useRevealShown(list, shown !== null && rows.length > 0 && !waiting);

  const shownSeries = groups.filtered.find((s) => s.id === shown);
  const activeLetter = shownSeries ? firstLetter(shownSeries) : null;

  return (
    <div className="au-page" data-pane={id === undefined ? "index" : "series"}>
      <aside className="au-list" aria-label="Series">
        <ListHead
          copy={COPY}
          total={total}
          filter={filter}
          sort={sort}
          readingCount={readingCount}
          onlyReading={onlyReading}
          onFilter={setFilter}
          onSort={(next) => {
            setSort(next);
            saveDiscoverySort("series_sort", next);
          }}
          onOnlyReading={setOnlyReading}
        />
        <ListBody
          copy={COPY}
          groups={groups}
          sort={sort}
          waiting={waiting}
          active={activeLetter}
          failure={phase === "failed" ? (series.error?.message ?? "") : null}
          any={rows.length > 0}
          listRef={list}
          row={(s) => (
            <SeriesRow
              key={s.id}
              series={s}
              progress={progress?.get(s.id)}
              state={readingState}
              shown={shown === s.id}
              current={routed === s.id}
            />
          )}
        />
      </aside>
      <section className="au-detail">
        <Outlet context={preview} />
      </section>
    </div>
  );
}

/** `/series`' pane: the previewed series' page, without claiming the route. */
export function SeriesIndexPane() {
  const preview = useOutletContext<Preview<SeriesId>>();
  return (
    <>
      <PageTitle page="Series" />
      {preview.kind === "pending" ? (
        <Loading kind="section" label="Gathering every series" />
      ) : preview.kind === "unavailable" ? (
        <p className="au-pane-empty subtitle">Couldn’t load series.</p>
      ) : preview.kind === "empty" ? (
        <p className="au-pane-empty subtitle">{NO_SERIES}</p>
      ) : (
        <SeriesPane key={preview.id} id={preview.id} preview />
      )}
    </>
  );
}

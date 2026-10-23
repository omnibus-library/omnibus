import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { type SeriesSummary, seriesListQuery } from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { loadDiscoveryPrefs, saveDiscoverySort } from "../../viewPrefs";
import {
  filterAndSortSeries,
  type SeriesSort,
  splitLastWord,
} from "./seriesIndex";
import "../../components/DiscPage/DiscPage.css";
import "./Series.css";

const SORTS = [
  ["name", "A–Z", "series-sort-name"],
  ["book_count", "Most books", "series-sort-count"],
] as const satisfies readonly [SeriesSort, string, string][];

function SeriesCard({ series }: { series: SeriesSummary }) {
  const [rest, last] = splitLastWord(series.name);
  return (
    <Link
      to={`/series/${series.id}`}
      className="idx-card idx-card-series"
      style={series.accent ? { "--accent": series.accent } : undefined}
      data-testid="series-card"
    >
      <div className="idx-series-spine" aria-hidden="true" />
      <div className="idx-card-body">
        <div className="idx-card-title">
          {rest && <span className="idx-card-name-rest">{`${rest} `}</span>}
          <span className="idx-card-name-last">{last}</span>
        </div>
        {series.primaryAuthor && (
          <div className="mono idx-series-author">{series.primaryAuthor}</div>
        )}
        <div className="idx-card-stats">
          <div className="idx-stat">
            <div className="mono idx-stat-label">Books</div>
            <div className="idx-stat-value">{series.bookCount}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

/** `/series`: every series as a card, filtered by name or author and ordered A–Z or by size. */
export function Series() {
  const query = useQuery(seriesListQuery);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState(() => loadDiscoveryPrefs().series_sort);

  if (!query.data) {
    return query.isError ? (
      <PageError message={query.error.message} />
    ) : (
      <Loading kind="page" label="Gathering every series" />
    );
  }
  const all = query.data;
  const shown = filterAndSortSeries(all, filter, sort);
  const books = all.reduce((sum, s) => sum + s.bookCount, 0);

  return (
    <div className="idx-page">
      <PageTitle page="Series" />
      <div className="idx-header">
        <div className="idx-head-row">
          <div>
            <span className="label">Library lens</span>
            <h1 className="disc-hero-title">
              By <em>series</em>.
            </h1>
            <p className="idx-subtitle">
              {`${all.length} series · ${books} books across them.`}
            </p>
          </div>
        </div>
        <div className="idx-toolbar">
          <div className="idx-search">
            <input
              type="search"
              placeholder="Filter series by name or author…"
              aria-label="Filter series"
              value={filter}
              data-testid="series-filter"
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="idx-sort">
            <span className="label">Sort</span>
            {SORTS.map(([axis, label, testid]) => (
              <button
                key={axis}
                type="button"
                className="idx-btn"
                aria-pressed={
                  sort === axis || (axis === "name" && sort === "recent")
                }
                data-testid={testid}
                onClick={() => {
                  setSort(axis);
                  saveDiscoverySort("series_sort", axis);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="idx-body">
        {shown.length === 0 ? (
          <p className="subtitle idx-empty">
            {all.length === 0
              ? "No series yet — index a library to see them here."
              : "No series match that filter."}
          </p>
        ) : (
          <div className="idx-series-grid">
            {shown.map((s) => (
              <div key={s.id}>
                <SeriesCard series={s} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

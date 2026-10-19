import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useOutletContext, useParams } from "react-router";
import {
  type AuthorId,
  type AuthorReading,
  type AuthorSummary,
  authorReadingQuery,
  authorsQuery,
  parseAuthorId,
} from "../../api";
import { Loading, RowSkeletons } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { bookCount } from "../../format";
import { loadDiscoveryPrefs, saveDiscoverySort } from "../../viewPrefs";
import { AuthorPane } from "../AuthorDetail/AuthorPane";
import {
  type AuthorSort,
  byAuthor,
  computeAuthorGroups,
  defaultAuthor,
  firstLetter,
  letterFrag,
  nameParts,
  type ReadingMap,
} from "./authorsOrder";
import { LetterRail } from "./LetterRail";
import "./Authors.css";

/** The reader's progress per author: unknown until its request returns, and for good if it fails, never zero. */
type ReadingState = "pending" | "ready" | "failed";

/** Which author `/authors` previews before the reader picks one. */
type Preview =
  | { kind: "pending" }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "author"; id: AuthorId };

const SORTS = [
  ["name", "Surname", "authors-sort-name"],
  ["book_count", "Most books", "authors-sort-count"],
  ["recent", "Recent", "authors-sort-recent"],
] as const satisfies readonly [AuthorSort, string, string][];

const NO_AUTHORS: AuthorSummary[] = [];

// A failed refresh keeps its rows, so only a first load that fails leaves nothing to preview.
function previewOf(
  rows: AuthorSummary[],
  list: { isError: boolean; isPending: boolean },
  readingState: ReadingState,
  progress: ReadingMap | null,
): Preview {
  if (list.isError && rows.length === 0) return { kind: "unavailable" };
  if (list.isPending || readingState === "pending") return { kind: "pending" };
  const id = defaultAuthor(rows, progress);
  return id === null ? { kind: "empty" } : { kind: "author", id };
}

function AuthorsListHead({
  total,
  filter,
  sort,
  readingCount,
  onlyReading,
  onFilter,
  onSort,
  onOnlyReading,
}: {
  total: number | null;
  filter: string;
  sort: AuthorSort;
  readingCount: number | null;
  onlyReading: boolean;
  onFilter: (text: string) => void;
  onSort: (sort: AuthorSort) => void;
  onOnlyReading: (on: boolean) => void;
}) {
  return (
    <header className="au-list-head">
      <h1 className="au-title">
        Authors
        <span className="au-title-count">{total}</span>
      </h1>
      <label className="au-search">
        <svg className="au-search-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.75" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          type="search"
          placeholder="Filter by name…"
          aria-label="Filter authors by name"
          value={filter}
          data-testid="authors-filter"
          onChange={(e) => onFilter(e.target.value)}
        />
      </label>
      <div className="au-controls">
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the au-sort rules never reset */}
        <div className="au-sort" role="group" aria-label="Sort authors">
          {SORTS.map(([axis, label, testid]) => (
            <button
              key={axis}
              type="button"
              className="au-sort-btn"
              aria-pressed={sort === axis}
              data-testid={testid}
              onClick={() => onSort(axis)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="au-chip"
          aria-pressed={onlyReading}
          aria-busy={readingCount === null}
          disabled={readingCount === null}
          data-testid="authors-reading-filter"
          onClick={() => onOnlyReading(!onlyReading)}
        >
          <span
            className={readingCount === null ? "ld-sheen" : "au-chip-label"}
          >
            Reading
          </span>
          <span className="au-chip-count">{readingCount}</span>
        </button>
      </div>
    </header>
  );
}

/** The row's progress: finished in the author's accent, in progress a lighter tint; a skeleton while pending, blank if it never loads. */
function RowBar({
  count,
  progress,
  state,
}: {
  count: number;
  progress: AuthorReading | undefined;
  state: ReadingState;
}) {
  const className = {
    pending: "au-bar ld-skel",
    ready: "au-bar",
    failed: "au-bar is-unknown",
  }[state];
  const pct = (n: number) =>
    count === 0 ? 0 : Math.floor((Math.min(n, count) * 100) / count);
  return (
    <span
      className={className}
      aria-hidden="true"
      data-testid="author-row-bar"
      data-state={state === "failed" ? "unknown" : state}
    >
      <span
        className="au-bar-done"
        style={{ width: `${pct(progress?.finished ?? 0)}%` }}
      />
      <span
        className="au-bar-now"
        style={{ width: `${pct(progress?.reading ?? 0)}%` }}
      />
    </span>
  );
}

function AuthorRow({
  author,
  progress,
  state,
  shown,
  current,
}: {
  author: AuthorSummary;
  progress: AuthorReading | undefined;
  state: ReadingState;
  shown: boolean;
  current: boolean;
}) {
  const [last, rest] = nameParts(author);
  const finished = progress?.finished ?? 0;
  const label = `${author.name}, ${bookCount(author.bookCount)}${finished > 0 ? `, ${finished} finished` : ""}`;
  return (
    <Link
      to={`/authors/${author.id}`}
      className={shown ? "au-row is-shown" : "au-row"}
      style={{ "--au-accent": author.accent ?? "var(--accent)" }}
      aria-current={current ? "page" : undefined}
      aria-label={label}
      data-testid="author-card"
    >
      <span className="au-row-name">
        <span className="au-row-last">{last}</span>
        {rest && <span className="au-row-rest">{`, ${rest}`}</span>}
      </span>
      <RowBar count={author.bookCount} progress={progress} state={state} />
      <span className="au-row-count">{author.bookCount}</span>
    </Link>
  );
}

/** Scrolls the pane's author to the middle of the list once it has a row, so a deep link to someone under W doesn't open on the A's. */
function useRevealShown(
  list: RefObject<HTMLDivElement | null>,
  ready: boolean,
) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const row = list.current?.querySelector<HTMLElement>(".au-row.is-shown");
    if (
      list.current &&
      row &&
      list.current.scrollHeight > list.current.clientHeight
    ) {
      list.current.scrollTop =
        row.offsetTop - (list.current.clientHeight - row.offsetHeight) / 2;
    }
  }, [list, ready]);
}

/** List + pane for both author routes; the list keeps its filter, sort and scroll while the pane changes. */
export function Authors() {
  const { id } = useParams();
  const routed = parseAuthorId(id);
  const authors = useQuery(authorsQuery);
  const reading = useQuery(authorReadingQuery);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState(() => loadDiscoveryPrefs().authors_sort);
  const [onlyReading, setOnlyReading] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const rows = authors.data ?? NO_AUTHORS;
  const readingState: ReadingState = reading.data
    ? "ready"
    : reading.isError
      ? "failed"
      : "pending";
  const progress = useMemo<ReadingMap | null>(
    () => (reading.data ? byAuthor(reading.data) : null),
    [reading.data],
  );
  const groups = useMemo(
    () =>
      computeAuthorGroups(rows, {
        text: filter,
        sort,
        reading: progress,
        onlyReading,
      }),
    [rows, filter, sort, progress, onlyReading],
  );

  const { isError, isPending } = authors;
  const preview = useMemo(
    () => previewOf(rows, { isError, isPending }, readingState, progress),
    [rows, isError, isPending, readingState, progress],
  );
  const shown = routed ?? (preview.kind === "author" ? preview.id : null);
  const readingCount = progress
    ? [...progress.values()].filter((r) => r.reading > 0).length
    : null;
  const total =
    !authors.isPending && (rows.length > 0 || !authors.isError)
      ? rows.length
      : null;
  // Recent orders by progress, so it has no order to show until that lands.
  const waiting =
    authors.isPending || (sort === "recent" && readingState === "pending");
  useRevealShown(list, shown !== null && rows.length > 0 && !waiting);

  const row = (a: AuthorSummary) => (
    <AuthorRow
      key={a.id}
      author={a}
      progress={progress?.get(a.id)}
      state={readingState}
      shown={shown === a.id}
      current={routed === a.id}
    />
  );
  const shownAuthor = groups.filtered.find((a) => a.id === shown);
  const activeLetter = shownAuthor ? firstLetter(shownAuthor) : null;

  return (
    <div className="au-page" data-pane={id === undefined ? "index" : "author"}>
      <aside className="au-list" aria-label="Authors">
        <AuthorsListHead
          total={total}
          filter={filter}
          sort={sort}
          readingCount={readingCount}
          onlyReading={onlyReading}
          onFilter={setFilter}
          onSort={(next) => {
            setSort(next);
            saveDiscoverySort("authors_sort", next);
          }}
          onOnlyReading={setOnlyReading}
        />
        <div className="au-list-body">
          <div className="au-scroll" data-testid="authors-list" ref={list}>
            {waiting ? (
              <RowSkeletons count={12} avatar={false} />
            ) : authors.isError && rows.length === 0 ? (
              <p className="au-list-note error" role="alert">
                {`Couldn’t load authors: ${authors.error.message}`}
              </p>
            ) : groups.filtered.length === 0 ? (
              <p className="au-list-note subtitle">
                {rows.length > 0
                  ? "No authors match."
                  : "No authors yet — the library is empty."}
              </p>
            ) : sort === "name" ? (
              groups.letters.map(([letter, group]) => (
                <section
                  key={letter}
                  id={`letter-${letterFrag(letter)}`}
                  className="au-group"
                >
                  <div className="au-group-head">
                    <span>{letter}</span>
                    <span>{group.length}</span>
                  </div>
                  {group.map(row)}
                </section>
              ))
            ) : (
              <div className="au-group">{groups.filtered.map(row)}</div>
            )}
          </div>
          {sort === "name" && !waiting && groups.letters.length > 0 && (
            <LetterRail
              present={groups.letters.map(([letter]) => letter)}
              active={activeLetter}
            />
          )}
        </div>
      </aside>
      <section className="au-detail">
        <Outlet context={preview} />
      </section>
    </div>
  );
}

/** `/authors`' pane: the previewed author's page, without claiming the route. */
export function AuthorsIndexPane() {
  const preview = useOutletContext<Preview>();
  return (
    <>
      <PageTitle page="Authors" />
      {preview.kind === "pending" ? (
        <Loading kind="section" label="Gathering every author" />
      ) : preview.kind === "unavailable" ? (
        <p className="au-pane-empty subtitle">Couldn’t load authors.</p>
      ) : preview.kind === "empty" ? (
        <p className="au-pane-empty subtitle">
          No authors yet — the library is empty.
        </p>
      ) : (
        <AuthorPane key={preview.id} id={preview.id} preview />
      )}
    </>
  );
}

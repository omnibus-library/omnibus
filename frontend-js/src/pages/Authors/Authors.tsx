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
  type AuthorId,
  type AuthorReading,
  type AuthorSummary,
  authorReadingQuery,
  authorsQuery,
  parseAuthorId,
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
import { bookCount } from "../../format";
import {
  useScrollRestore,
  useScrollRestoreOnChange,
} from "../../scrollRestore";
import { loadDiscoveryPrefs, saveDiscoverySort } from "../../viewPrefs";
import { AuthorPane } from "../AuthorDetail/AuthorPane";
import {
  byAuthor,
  computeAuthorGroups,
  defaultAuthor,
  firstLetter,
  nameParts,
  type ReadingMap,
} from "./authorsOrder";

const COPY: ListCopy = {
  title: "Authors",
  noun: "authors",
  testid: "authors",
  filterPlaceholder: "Filter by name…",
  filterLabel: "Filter authors by name",
  nameSort: "Surname",
  empty: "No authors yet — the library is empty.",
};

const NO_AUTHORS: AuthorSummary[] = [];

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
      <RowBar
        count={author.bookCount}
        progress={progress}
        state={state}
        testid="author-row-bar"
      />
      <span className="au-row-count">{author.bookCount}</span>
    </Link>
  );
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
  const pathname = useLocation().pathname;
  useScrollRestore(authors.data !== undefined, pathname);
  useScrollRestoreOnChange(pathname);

  const rows = authors.data ?? NO_AUTHORS;
  const readingState = readingStateOf(reading);
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

  const phase = listPhase({
    isPending: authors.isPending,
    isError: authors.isError,
    hasRows: rows.length > 0,
  });
  const preview = useMemo(
    () => previewOf(phase, readingState, () => defaultAuthor(rows, progress)),
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
            saveDiscoverySort("authors_sort", next);
          }}
          onOnlyReading={setOnlyReading}
        />
        <ListBody
          copy={COPY}
          groups={groups}
          sort={sort}
          waiting={waiting}
          active={activeLetter}
          failure={phase === "failed" ? (authors.error?.message ?? "") : null}
          any={rows.length > 0}
          listRef={list}
          row={row}
        />
      </aside>
      <section className="au-detail">
        <Outlet context={preview} />
      </section>
    </div>
  );
}

/** `/authors`' pane: the previewed author's page, without claiming the route. */
export function AuthorsIndexPane() {
  const preview = useOutletContext<Preview<AuthorId>>();
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

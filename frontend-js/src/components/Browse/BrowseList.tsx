import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { RowSkeletons } from "../Loading/Loading";
import {
  type BrowseSort,
  type Groups,
  type ListPhase,
  letterFrag,
} from "./browseOrder";
import { LetterRail } from "./LetterRail";
import "./Browse.css";

/** The words and test ids a list wears, so one head and body serve each page. */
export type ListCopy = {
  /** The h1, such as "Authors". */
  title: string;
  /** The plural in the list's notes, such as "authors". */
  noun: string;
  /** The test-id prefix: `{testid}-filter`, `{testid}-sort-name`, … */
  testid: string;
  filterPlaceholder: string;
  filterLabel: string;
  /** The name sort's button label, such as "Surname". */
  nameSort: string;
  /** What the list says when it has no rows at all. */
  empty: string;
};

/** The reader's progress per row: unknown until its request returns, and for good if it fails, never zero. */
export type ReadingState = "pending" | "ready" | "failed";

/** Which row a bare index route previews before the reader picks one. */
export type Preview<Id> =
  | { kind: "pending" }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "item"; id: Id };

export const readingStateOf = (request: {
  data: unknown;
  isError: boolean;
}): ReadingState =>
  request.data ? "ready" : request.isError ? "failed" : "pending";

/** The row `/` previews: waits for the list and the progress, so it never lands on one row and jumps to another. */
export function previewOf<Id>(
  phase: ListPhase,
  readingState: ReadingState,
  pick: () => Id | null,
): Preview<Id> {
  if (phase === "failed") return { kind: "unavailable" };
  if (phase === "loading" || readingState === "pending") {
    return { kind: "pending" };
  }
  const id = pick();
  return id === null ? { kind: "empty" } : { kind: "item", id };
}

/** Title, filter, sort and the Reading filter above the list. */
export function ListHead({
  copy,
  total,
  filter,
  sort,
  readingCount,
  onlyReading,
  onFilter,
  onSort,
  onOnlyReading,
}: {
  copy: ListCopy;
  total: number | null;
  filter: string;
  sort: BrowseSort;
  readingCount: number | null;
  onlyReading: boolean;
  onFilter: (text: string) => void;
  onSort: (sort: BrowseSort) => void;
  onOnlyReading: (on: boolean) => void;
}) {
  const sorts = [
    ["name", copy.nameSort, "name"],
    ["book_count", "Most books", "count"],
    ["recent", "Recent", "recent"],
  ] as const satisfies readonly [BrowseSort, string, string][];
  return (
    <header className="au-list-head">
      <h1 className="au-title">
        {copy.title}
        <span className="au-title-count">{total}</span>
      </h1>
      <label className="au-search">
        <svg className="au-search-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.75" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          type="search"
          placeholder={copy.filterPlaceholder}
          aria-label={copy.filterLabel}
          value={filter}
          data-testid={`${copy.testid}-filter`}
          onChange={(e) => onFilter(e.target.value)}
        />
      </label>
      <div className="au-controls">
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the au-sort rules never reset */}
        <div className="au-sort" role="group" aria-label={`Sort ${copy.noun}`}>
          {sorts.map(([axis, label, id]) => (
            <button
              key={axis}
              type="button"
              className="au-sort-btn"
              aria-pressed={sort === axis}
              data-testid={`${copy.testid}-sort-${id}`}
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
          data-testid={`${copy.testid}-reading-filter`}
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

/** The scrolling list: skeleton rows while waiting, letter groups under the name sort, one flat run under the others, and the A–Z rail beside it. */
export function ListBody<T>({
  copy,
  groups,
  sort,
  waiting,
  active,
  failure,
  any,
  listRef,
  row,
}: {
  copy: ListCopy;
  groups: Groups<T>;
  sort: BrowseSort;
  /** Rows or the order they need are still loading. */
  waiting: boolean;
  /** The letter of the row in the pane, marked on the rail. */
  active: string | null;
  /** Why the first load failed, when it did. */
  failure: string | null;
  /** Whether the library has any rows, filtered or not. */
  any: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  row: (item: T) => ReactNode;
}) {
  return (
    <div className="au-list-body">
      <div
        className="au-scroll"
        data-testid={`${copy.testid}-list`}
        ref={listRef}
      >
        {waiting ? (
          <RowSkeletons count={12} avatar={false} />
        ) : failure !== null ? (
          <p className="au-list-note error" role="alert">
            {`Couldn’t load ${copy.noun}: ${failure}`}
          </p>
        ) : groups.filtered.length === 0 ? (
          <p className="au-list-note subtitle">
            {any ? `No ${copy.noun} match.` : copy.empty}
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
          testid={copy.testid}
          present={groups.letters.map(([letter]) => letter)}
          active={active}
        />
      )}
    </div>
  );
}

/** A row's progress: finished in its accent, in progress a lighter tint; a skeleton while pending, blank if it never loads. */
export function RowBar({
  count,
  progress,
  state,
  testid,
}: {
  count: number;
  progress: { finished: number; reading: number } | undefined;
  state: ReadingState;
  testid: string;
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
      data-testid={testid}
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

/** Scrolls the pane's row to the middle of the list once it has one, so a deep link to someone under W doesn't open on the A's. */
export function useRevealShown(
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

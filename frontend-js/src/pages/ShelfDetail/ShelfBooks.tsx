import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  type Book,
  type FilterClause,
  fetchShelfPage,
  invalidateShelf,
  type SortKey,
  setShelfMember,
} from "../../api";
import { CoverImage } from "../../components/Cover/CoverImage";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import { PlusGlyph, XGlyph } from "../../components/Glyphs/Glyphs";
import { CoverSkeletons } from "../../components/Loading/Loading";
import { AddBooksTile } from "../../components/ShelfTile/ShelfTile";
import { lastLibrary, loadPrefs, savePrefs } from "../../viewPrefs";
import { defaultDirFor } from "../Library/sorting";
import { type FullList, rows } from "./narrow";
import "../Library/Library.css";
import "./ShelfDetail.css";

const SORTS = [
  ["recently_interacted", "Recently read"],
  ["title", "Title"],
  ["author", "Author"],
  ["series", "Series"],
  ["newest_added", "Newest added"],
  ["last_updated", "Recently updated"],
] as const satisfies readonly [SortKey, string][];

const EMPTY = {
  manual: "No books on this shelf yet.",
  smart: "No books match this shelf’s rules yet.",
  wishlist: "Nothing on this wishlist yet.",
} as const;

type BooksProps = {
  shelfId: number;
  kind: keyof typeof EMPTY;
  /** The viewer may change this shelf's books or rules. */
  canEdit: boolean;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  full: FullList;
  onAdd: () => void;
  onEdit: () => void;
};

function Member({
  book,
  removable,
  leaving,
  onRemove,
}: {
  book: Book;
  removable: boolean;
  leaving: boolean;
  onRemove: () => void;
}) {
  return (
    <div className={leaving ? "shd-tile shd-tile--leaving" : "shd-tile"}>
      <Link
        to={`/books/${book.uuid}`}
        className="cover-link lib-tile"
        role="listitem"
        data-testid="shelf-tile"
        aria-label={`Open details for ${book.title}`}
      >
        <CoverImage book={book} sizes="(max-width: 640px) 160px, 200px" />
        <div className="lib-tile-title">{book.title}</div>
      </Link>
      {removable && (
        <button
          type="button"
          className="shd-tile-remove"
          data-testid={`shelf-remove-${book.uuid}`}
          aria-label={`Remove ${book.title} from this shelf`}
          title="Remove from shelf"
          disabled={leaving}
          onClick={onRemove}
        >
          <XGlyph />
        </button>
      )}
    </div>
  );
}

/** The member books: heading and count, a smart shelf's sort, the library filter, any failure, then the grid or an empty state in the kind's terms. */
export function ShelfBooks({
  shelfId,
  kind,
  canEdit,
  sort,
  onSort,
  full,
  onAdd,
  onEdit,
}: BooksProps) {
  const client = useQueryClient();
  // Start from the library's saved filter and file edits back there; with no library browsed yet it lives in memory.
  const [clauses, setClauses] = useState<FilterClause[]>(() => {
    const library = lastLibrary();
    return library ? loadPrefs(library).clauses : [];
  });
  const [leaving, setLeaving] = useState<string[]>([]);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const filtered = clauses.length > 0;
  const query = { sort, dir: defaultDirFor(sort), clauses };
  const narrowed = useQuery({
    queryKey: ["shelf-page", shelfId, query],
    queryFn: () => fetchShelfPage(shelfId, query),
    enabled: filtered,
  });
  const view = rows(filtered, full, {
    books: narrowed.data,
    failed: narrowed.isError,
  });
  const removable = canEdit && kind === "manual";

  const setFilter = (next: FilterClause[]) => {
    const library = lastLibrary();
    if (library) savePrefs(library, { ...loadPrefs(library), clauses: next });
    setClauses(next);
  };
  const take = async (book: Book) => {
    setLeaving((l) => [...l, book.uuid]);
    setRemoveError(null);
    try {
      await setShelfMember(shelfId, book.uuid, false);
      await invalidateShelf(client, shelfId);
    } catch (e) {
      setRemoveError(
        `Couldn’t remove “${book.title}” from this shelf: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      setLeaving((l) => l.filter((u) => u !== book.uuid));
    }
  };

  return (
    <section className="shd-books" aria-labelledby="shd-books-title">
      <div className="shd-books-head">
        <h2 className="shd-books-title" id="shd-books-title">
          Books
          {view.pending ? (
            <span
              className="mono shd-books-count ld-sheen"
              data-testid="shelf-count-pending"
            >
              counting
            </span>
          ) : (
            !view.unavailable && (
              <span className="mono shd-books-count" data-testid="shelf-count">
                {view.books.length}
              </span>
            )
          )}
        </h2>
        {kind === "smart" && (
          <label className="shd-sort">
            <span className="label">Sort</span>
            <select
              className="shelf-select"
              data-testid="shelf-sort"
              value={sort}
              onChange={(e) =>
                onSort(
                  SORTS.find(([key]) => key === e.target.value)?.[0] ?? sort,
                )
              }
            >
              {SORTS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <FilterBar clauses={clauses} onChange={setFilter} />
      {view.errored && (
        <p
          role="alert"
          className="error shd-alert"
          data-testid="shelf-refetch-error"
        >
          Couldn’t refresh this shelf. Check your connection and try again.
        </p>
      )}
      {removeError && (
        <p
          role="alert"
          className="error shd-alert"
          data-testid="shelf-remove-error"
        >
          {removeError}
        </p>
      )}
      {view.pending ? (
        <div
          className="shd-grid-pending"
          role="status"
          aria-live="polite"
          data-testid="shelf-loading"
        >
          <span className="ld-sr">Taking the books off the shelf</span>
          <CoverSkeletons count={6} />
        </div>
      ) : view.filteredOut ? (
        <div className="shd-empty" data-testid="shelf-filtered-empty">
          <p className="shd-empty-msg">
            No books on this shelf match these filters.
          </p>
          <button
            type="button"
            className="btn"
            data-testid="shelf-filtered-clear"
            onClick={() => setFilter([])}
          >
            Clear filters
          </button>
        </div>
      ) : view.books.length === 0 && !view.errored ? (
        <div className="shd-empty" data-testid="shelf-empty">
          <p className="shd-empty-msg">{EMPTY[kind]}</p>
          {canEdit && kind === "manual" && (
            <button
              type="button"
              className="btn primary"
              data-testid="shelf-empty-add"
              onClick={onAdd}
            >
              <PlusGlyph />
              Add books
            </button>
          )}
          {canEdit && kind === "smart" && (
            <button
              type="button"
              className="btn"
              data-testid="shelf-empty-edit"
              onClick={onEdit}
            >
              Edit rules
            </button>
          )}
        </div>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: the Atrium grid styles divs; list elements would bring the browser's list margins and padding
        <div
          className="lib-grid shelf-grid shd-grid"
          data-testid="shelf-grid"
          role="list"
        >
          {view.books.map((book) => (
            <Member
              key={book.uuid}
              book={book}
              removable={removable}
              leaving={leaving.includes(book.uuid)}
              onRemove={() => take(book)}
            />
          ))}
          {removable && full.ready && <AddBooksTile onClick={onAdd} />}
        </div>
      )}
    </section>
  );
}

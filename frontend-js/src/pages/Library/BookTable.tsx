import { type RefObject, useState } from "react";
import { Link } from "react-router";
import { type Book, type SortKey, thumbSrcSet, thumbUrl } from "../../api";
import { formatDateShort, formatInstantShort } from "../../format";
import type { Prefs } from "../../viewPrefs";

type SortableColumn = { className: string; label: string; sort: SortKey };

// Spelled out whole, so the Atrium extractor finds each class.

const SORTABLE = {
  title: { className: "ebook-col-title", label: "Title", sort: "title" },
  author: { className: "ebook-col-author", label: "Author", sort: "author" },
  series: { className: "ebook-col-series", label: "Series", sort: "series" },
  updated: {
    className: "ebook-col-updated",
    label: "Last Updated",
    sort: "last_updated",
  },
  added: { className: "ebook-col-added", label: "Added", sort: "newest_added" },
} satisfies Record<string, SortableColumn>;

function SortableHeader({
  column,
  prefs,
  locked,
  onSort,
}: {
  column: SortableColumn;
  prefs: Prefs;
  locked: boolean;
  onSort: (key: SortKey) => void;
}) {
  // A locked list is ordered by the server, so the stored axis describes none of its rows.
  const active = !locked && prefs.sort === column.sort;
  const ariaSort = active
    ? prefs.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const arrow = active ? (prefs.dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th className={`${column.className} sort-th`} aria-sort={ariaSort}>
      <button
        type="button"
        className="sort-th-btn"
        disabled={locked}
        onClick={() => onSort(column.sort)}
      >
        {column.label}
        {arrow}
      </button>
    </th>
  );
}

function RowCover({ book }: { book: Book }) {
  const [broken, setBroken] = useState(false);
  return (
    <td className="ebook-col-cover">
      <Link
        to={`/books/${book.uuid}`}
        className="ebook-cover-link"
        aria-label={`Open details for ${book.title}`}
      >
        {book.hasCover && !broken ? (
          <img
            className="ebook-thumb"
            src={thumbUrl(book.uuid)}
            srcSet={thumbSrcSet(book.uuid)}
            sizes="(max-width: 560px) 22px, 26px"
            alt={`Cover of ${book.title}`}
            loading="lazy"
            width={320}
            height={480}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="ebook-thumb ebook-thumb-fallback">—</div>
        )}
      </Link>
    </td>
  );
}

function Formats({ book }: { book: Book }) {
  if (book.formats.length === 0 && !book.hasPhysical) {
    return <span className="ebook-cell-formats-empty">—</span>;
  }
  return (
    <>
      {book.formats.map((format) => (
        <span key={format} className="format-badge">
          {format.trim().toUpperCase()}
        </span>
      ))}
      {book.hasPhysical && (
        <span
          className="format-badge format-badge--physical"
          title="In your physical collection"
        >
          PHYS
        </span>
      )}
    </>
  );
}

type Selection = {
  selected: ReadonlySet<string>;
  /** Checks or unchecks every one of `uuids`. */
  onChange: (uuids: string[], checked: boolean) => void;
};

function Row({ book, select }: { book: Book; select?: Selection }) {
  const checked = select?.selected.has(book.uuid) ?? false;
  return (
    <tr className="ebook-row">
      {select && (
        <td className="ebook-col-select">
          <input
            type="checkbox"
            aria-label={`Select ${book.title}`}
            checked={checked}
            onChange={() => select.onChange([book.uuid], !checked)}
          />
        </td>
      )}
      <RowCover book={book} />
      <td className="ebook-col-title">
        <div className="ebook-title-cell">{book.title}</div>
      </td>
      <td className="ebook-col-author">
        <div className="ebook-title-cell">{book.authors.join(", ")}</div>
      </td>
      <td className="ebook-col-series">
        <div className="ebook-title-cell">
          {book.series &&
            `${book.series.name}${book.series.index ? ` #${book.series.index}` : ""}`}
        </div>
      </td>
      <td className="ebook-col-tags">
        <div className="ebook-title-cell">{book.subjects.join(", ")}</div>
      </td>
      <td className="ebook-col-genres">
        <div className="ebook-title-cell">{book.genres.join(", ")}</div>
      </td>
      <td className="ebook-col-published">
        <div className="ebook-title-cell">
          {formatDateShort(book.published ?? "")}
        </div>
      </td>
      <td className="ebook-col-formats">
        <Formats book={book} />
      </td>
      <td className="ebook-col-updated">
        {formatInstantShort(book.modified ?? "")}
      </td>
      <td className="ebook-col-added">
        {formatInstantShort(book.addedAt ?? "")}
      </td>
      <td className="ebook-col-language">
        <div className="ebook-title-cell">{book.language ?? ""}</div>
      </td>
    </tr>
  );
}

type BookTableProps = {
  books: Book[];
  prefs: Prefs;
  /** Why sorting is inert on this list, or `null` when it acts. */
  sortLock: string | null;
  onSort: (key: SortKey) => void;
  /** Bulk selection; the select column is drawn only when given. */
  select?: Selection;
  /** The select-all checkbox, where a closing dialog hands focus back. */
  selectAllRef?: RefObject<HTMLInputElement | null>;
};

/** The dense table view: one read-only row per book, sortable by column header. */
export function BookTable({
  books,
  prefs,
  sortLock,
  onSort,
  select,
  selectAllRef,
}: BookTableProps) {
  const all =
    books.length > 0 && books.every((book) => select?.selected.has(book.uuid));
  const header = (column: SortableColumn) => (
    <SortableHeader
      column={column}
      prefs={prefs}
      locked={sortLock !== null}
      onSort={onSort}
    />
  );
  return (
    <div className="ebook-table-wrap">
      <table className="ebook-table">
        <thead>
          <tr>
            {select && (
              <th className="ebook-col-select">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all books"
                  checked={all}
                  onChange={() =>
                    select.onChange(
                      books.map((book) => book.uuid),
                      !all,
                    )
                  }
                />
              </th>
            )}
            <th className="ebook-col-cover">Cover</th>
            {header(SORTABLE.title)}
            {header(SORTABLE.author)}
            {header(SORTABLE.series)}
            <th className="ebook-col-tags">Tags</th>
            <th className="ebook-col-genres">Genres</th>
            <th className="ebook-col-published">Published</th>
            <th className="ebook-col-formats">Formats</th>
            {header(SORTABLE.updated)}
            {header(SORTABLE.added)}
            <th className="ebook-col-language">Language</th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <Row key={book.uuid} book={book} select={select} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

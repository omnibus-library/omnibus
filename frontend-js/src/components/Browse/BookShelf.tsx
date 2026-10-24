import { Link } from "react-router";
import type { Book } from "../../api";
import { CoverImage } from "../Cover/CoverImage";
import { type BookStates, type Tally, tileBar } from "./bookStates";
import "./Browse.css";

/** One bar: the share of `total` books finished, then the share in progress. */
export function ProgressMeter({
  total,
  counts,
}: {
  total: number;
  counts: Tally;
}) {
  const pct = (n: number) => Math.floor((n * 100) / Math.max(total, 1));
  return (
    <div
      className="au-meter"
      role="img"
      aria-label={`${counts.finished} of ${total} finished, ${counts.reading} reading`}
    >
      <span
        className="au-meter-done"
        style={{ width: `${pct(counts.finished)}%` }}
      />
      <span
        className="au-meter-now"
        style={{ width: `${pct(counts.reading)}%` }}
      />
    </div>
  );
}

/** One book with a way in: cover, title, the meta line, and the button. */
export function BookCard({
  book,
  meta,
  action,
  to,
  testid,
  actionTestid,
}: {
  book: Book;
  /** The line under the title, such as "42% · read 3 days ago". */
  meta: string;
  /** The button's label, such as "Resume". */
  action: string;
  /** Where the button opens the book. */
  to: string;
  testid: string;
  actionTestid: string;
}) {
  return (
    <div className="au-current" data-testid={testid}>
      <Link
        to={`/books/${book.uuid}`}
        className="au-current-cover"
        aria-hidden="true"
        tabIndex={-1}
      >
        <CoverImage book={book} sizes="64px" />
      </Link>
      <div className="au-current-body">
        <Link to={`/books/${book.uuid}`} className="au-current-title">
          {book.title}
        </Link>
        <p className="au-current-meta">{meta}</p>
      </div>
      {/* A physical-only copy can be marked reading, but there is nothing to open. */}
      {book.formats.length > 0 && (
        <Link to={to} className="au-resume" data-testid={actionTestid}>
          {action}
        </Link>
      )}
    </div>
  );
}

/** A row of covers, each with the reader's bar under it and the line `caption` gives it, if any. */
export function BookGrid({
  books,
  states,
  caption = () => null,
}: {
  books: Book[];
  states: BookStates;
  caption?: (book: Book) => string | null;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the Atrium grid styles divs; list elements would bring the browser's list margins and padding
    <div className="au-grid" role="list">
      {books.map((book) => {
        const bar = tileBar(states.get(book.uuid));
        const line = caption(book);
        return (
          // biome-ignore lint/a11y/useSemanticElements: the list role sits on a wrapper so the tile stays a link to assistive tech
          <div key={book.uuid} className="au-tile-item" role="listitem">
            <Link
              to={`/books/${book.uuid}`}
              className="au-tile"
              aria-label={
                line === null
                  ? `Open details for ${book.title}`
                  : `Open details for ${book.title}, ${line}`
              }
            >
              <CoverImage book={book} sizes="(max-width: 720px) 30vw, 150px" />
              <span className="au-tile-bar" aria-hidden="true">
                {bar !== null && (
                  <span className="au-tile-fill" style={{ width: `${bar}%` }} />
                )}
              </span>
              {line !== null && <span className="au-tile-caption">{line}</span>}
              <span className="au-tile-title">{book.title}</span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

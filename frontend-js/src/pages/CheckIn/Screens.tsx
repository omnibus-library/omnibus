import { useState } from "react";
import type {
  ExternalBookMeta,
  ScanBook,
  WishlistAddRequest,
} from "../../api/generated/schemas";
import { Button, ButtonLink } from "../../components/Button/Button";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import {
  byline,
  closeMatchCopy,
  confirmSubtitle,
  type FoundVia,
  foundViaLine,
  metaDetails,
  wishlistSource,
} from "./checkIn";

/** Shown while the resolve request is in flight. */
export function ResolvingScreen() {
  return (
    <div className="check-in-screen" data-testid="check-in-resolving">
      <h1>Matching…</h1>
      <Loading kind="sheet" label="Checking your library, then the web." />
    </div>
  );
}

type CardProps = {
  cover: string | null | undefined;
  title: string;
  byline: string;
  series?: string | null;
  detail?: string | null;
};

/** The cover, title, byline and any provider facts of a resolved book. */
function BookCard({ cover, title, byline, series, detail }: CardProps) {
  // A provider cover can 404 or be blocked outright: fall back to the blank plate, not a broken-image glyph.
  const [broken, setBroken] = useState(false);
  return (
    <div className="check-in-book" data-testid="check-in-book">
      {cover && !broken ? (
        <img
          className="check-in-book-cover"
          src={cover}
          alt=""
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="check-in-book-cover check-in-book-cover--empty" />
      )}
      <div className="check-in-book-meta">
        <strong className="check-in-book-title">{title}</strong>
        {series && (
          <span
            className="check-in-book-series"
            data-testid="check-in-book-series"
          >
            {series}
          </span>
        )}
        {byline && <span className="check-in-book-byline">{byline}</span>}
        {detail && (
          <span
            className="check-in-book-detail"
            data-testid="check-in-book-detail"
          >
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}

/** A book the library holds. */
function LibraryBookCard({ book }: { book: ScanBook }) {
  return (
    <BookCard
      cover={book.cover_url}
      title={book.title}
      byline={byline(book.authors)}
    />
  );
}

/** A provider's record: the chooser's card, and a title-search result's. */
export function ExternalBookCard({ meta }: { meta: ExternalBookMeta }) {
  const authors = byline(meta.authors);
  return (
    <BookCard
      cover={meta.cover_url}
      title={meta.title}
      byline={[authors, meta.year].filter(Boolean).join(" · ")}
      series={meta.series}
      detail={metaDetails(meta)}
    />
  );
}

type ConfirmProps = {
  book: ScanBook;
  isbn: string;
  wishlisted: boolean;
  via: FoundVia;
  note: string;
  busy: boolean;
  onNote: (note: string) => void;
  onCheckIn: () => void;
  onCancel: () => void;
};

/** Confirms filing a copy against a book the library holds, or one on the reader's wishlist. */
export function ConfirmScreen({
  book,
  isbn,
  wishlisted,
  via,
  note,
  busy,
  onNote,
  onCheckIn,
  onCancel,
}: ConfirmProps) {
  return (
    <div className="check-in-screen" data-testid="check-in-confirm">
      <h1>Check in this copy</h1>
      <p className="subtitle">{confirmSubtitle(book, wishlisted)}</p>
      <LibraryBookCard book={book} />
      <div className="settings-field">
        <label htmlFor="check-in-note">Edition note (optional)</label>
        <input
          id="check-in-note"
          data-testid="check-in-note"
          type="text"
          placeholder="Paperback, 2019 reissue…"
          value={note}
          disabled={busy}
          onChange={(e) => onNote(e.target.value)}
        />
      </div>
      <p className="check-in-isbn-line">{foundViaLine(via, isbn)}</p>
      <div className="settings-actions">
        <Button
          variant="primary"
          disabled={busy}
          aria-busy={busy}
          data-testid="check-in-confirm-submit"
          onClick={onCheckIn}
        >
          <BusyLabel busy={busy} label="Check in" busyLabel="Checking in…" />
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          data-testid="check-in-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One row of a library-book picker: the card, that edition's ISBN, and the button that files the copy against it. */
export function LibraryPickOption({
  book,
  label,
  testId,
  onPick,
}: {
  book: ScanBook;
  label: string;
  testId: string;
  onPick: (book: ScanBook) => void;
}) {
  return (
    <li className="check-in-match-option">
      <LibraryBookCard book={book} />
      {book.isbn && (
        <p className="check-in-isbn-line">Library edition ISBN {book.isbn}</p>
      )}
      <Button
        variant="primary"
        data-testid={testId}
        onClick={() => onPick(book)}
      >
        {label}
      </Button>
    </li>
  );
}

type CloseMatchProps = {
  books: ScanBook[];
  scanned: ExternalBookMeta;
  via: FoundVia;
  onYes: (book: ScanBook) => void;
  onNo: (online: ExternalBookMeta) => void;
};

/** The fuzzy hits: never filed on their own; the reader picks the book they hold, or falls through to the chooser. */
export function CloseMatchScreen({
  books,
  scanned,
  via,
  onYes,
  onNo,
}: CloseMatchProps) {
  const copy = closeMatchCopy(books.length > 1, via);
  return (
    <div className="check-in-screen" data-testid="check-in-close-match">
      <h1>{copy.heading}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <p className="check-in-isbn-line">{foundViaLine(via, scanned.isbn13)}</p>
      <ul
        className="check-in-match-list"
        data-testid="check-in-close-match-list"
      >
        {books.map((book) => (
          <LibraryPickOption
            key={book.uuid}
            book={book}
            label={copy.pick}
            testId="check-in-close-match-pick"
            onPick={onYes}
          />
        ))}
      </ul>
      <p className="check-in-why">
        Print and digital editions carry different ISBNs, so we ask before
        checking a copy in against the wrong book.
      </p>
      <div className="settings-actions">
        <Button
          variant="ghost"
          data-testid="check-in-close-match-no"
          onClick={() => onNo(scanned)}
        >
          {copy.decline}
        </Button>
      </div>
    </div>
  );
}

type ChooseProps = {
  online: ExternalBookMeta;
  via: FoundVia;
  busy: boolean;
  onOwnIt: (meta: ExternalBookMeta) => void;
  onLink: () => void;
  onWishlist: (req: WishlistAddRequest) => void;
  onRestart: () => void;
};

/** Found online but not in the library: own it, link it to a book on the shelf, wishlist it, or start over. */
export function ChooseScreen({
  online,
  via,
  busy,
  onOwnIt,
  onLink,
  onWishlist,
  onRestart,
}: ChooseProps) {
  return (
    <div className="check-in-screen" data-testid="check-in-choose">
      <h1>Not in your library</h1>
      <p className="subtitle">We found it online. What would you like to do?</p>
      <ExternalBookCard meta={online} />
      {/* One flag covers every write, so the group, not any one button, reports the work. */}
      <div className="check-in-actions" aria-busy={busy}>
        <Button
          variant="primary"
          disabled={busy}
          data-testid="check-in-own-it"
          onClick={() => onOwnIt(online)}
        >
          I own it — add to my collection
        </Button>
        {/* A provider's record can carry a placeholder title that shares nothing with the library book, which no matching rung can bridge. */}
        <Button
          variant="ghost"
          disabled={busy}
          data-testid="check-in-link-existing"
          onClick={onLink}
        >
          I already have this book
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          data-testid="check-in-wishlist"
          onClick={() =>
            onWishlist({ meta: online, source: wishlistSource[via] })
          }
        >
          Add to my wishlist
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          data-testid="check-in-restart"
          onClick={onRestart}
        >
          Not the right book?
        </Button>
      </div>
    </div>
  );
}

/** Neither the library nor any provider knew the ISBN. */
export function UnresolvedScreen({
  isbn,
  onSearch,
  onLink,
  onRestart,
}: {
  isbn: string;
  onSearch: () => void;
  onLink: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="check-in-screen" data-testid="check-in-unresolved">
      <h1>We couldn't find that ISBN</h1>
      <p className="subtitle">
        Nothing in your library or our metadata providers matches {isbn}.
      </p>
      <div className="settings-actions">
        <Button
          variant="primary"
          data-testid="check-in-search-instead"
          onClick={onSearch}
        >
          Search by title instead
        </Button>
        {/* No provider knows the barcode, but the reader may own the book already, and filing a copy needs no provider. */}
        <Button
          variant="ghost"
          data-testid="check-in-link-existing"
          onClick={onLink}
        >
          I already have this book
        </Button>
        <Button
          variant="ghost"
          data-testid="check-in-restart"
          onClick={onRestart}
        >
          Try another ISBN
        </Button>
      </div>
    </div>
  );
}

type SuccessProps = {
  title: string;
  headline: string;
  /** The checked-in book, which "View book" opens; a wishlisted one has no files to open. */
  bookUuid: string | null;
  offWishlist: boolean;
  onRestart: () => void;
};

/** The landing for a completed check-in, reused with another headline for a wishlist add. */
export function SuccessScreen({
  title,
  headline,
  bookUuid,
  offWishlist,
  onRestart,
}: SuccessProps) {
  return (
    <div
      className="check-in-screen check-in-success"
      data-testid="check-in-success"
    >
      <div className="check-in-rings">
        <span className="check-in-ring" />
        <span className="check-in-ring" />
        <span className="check-in-tick">✓</span>
      </div>
      <h1>{headline}</h1>
      <p className="subtitle">{title}</p>
      {offWishlist && (
        <p className="check-in-why" data-testid="check-in-off-wishlist">
          Checked in and taken off your wishlist.
        </p>
      )}
      {bookUuid === null && (
        <p className="check-in-why">
          Wishlisted books have no files — they'll appear on your wishlist shelf
          until someone checks a copy in.
        </p>
      )}
      <div className="settings-actions">
        {bookUuid !== null && (
          <ButtonLink
            to={`/books/${bookUuid}`}
            data-testid="check-in-view-book"
          >
            View book
          </ButtonLink>
        )}
        <Button
          variant="ghost"
          data-testid="check-in-scan-another"
          onClick={onRestart}
        >
          Check in another
        </Button>
      </div>
    </div>
  );
}

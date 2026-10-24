import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  type AuthorId,
  type AuthorPage,
  authorPhotoUrl,
  authorQuery,
  type Book,
  type FilterClause,
} from "../../api";
import { AuthorPhotoEdit } from "../../components/AuthorPhotoEdit/AuthorPhotoEdit";
import {
  BookCard,
  BookGrid,
  ProgressMeter,
} from "../../components/Browse/BookShelf";
import {
  type BookStates,
  currentBook,
  shelfMeta,
  tally,
} from "../../components/Browse/bookStates";
import { Loading, Stale } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { initialOf, nowSecs } from "../../format";
import { readerHref } from "../../resume";
import { saveShelfSelection } from "../../viewPrefs";
import { AuthorMoreMenu } from "./AuthorMoreMenu";
import {
  currentMeta,
  groupBySeries,
  heroMeta,
  seriesCount,
} from "./authorProgress";

/** The portrait under its Edit button: the cached photo, else the name's initial; a photo that fails to load falls back to the initial for that URL. */
function AuthorAvatar({
  id,
  name,
  hasPhoto,
}: {
  id: AuthorId;
  name: string;
  hasPhoto: boolean;
}) {
  const client = useQueryClient();
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  // A replaced photo keeps its URL, cached for a day, so each change asks for a fresh one.
  const [version, setVersion] = useState(0);
  const photo = hasPhoto ? authorPhotoUrl(id) : null;
  const url = photo && version > 0 ? `${photo}?v=${version}` : photo;
  return (
    <AuthorPhotoEdit
      authorId={id}
      authorName={name}
      onChange={() => {
        setVersion((v) => v + 1);
        // The bare URL is what a remount or reload asks for, so replace its day-cached entry too.
        // shortcut: busts the browser's day-long cache from the client; upgrade when the author payload carries a photo version
        void fetch(authorPhotoUrl(id), { cache: "reload" });
        client.invalidateQueries({ queryKey: authorQuery(id).queryKey });
      }}
    >
      <div className="disc-avatar au-avatar">
        {url !== null && brokenSrc !== url ? (
          <img
            className="disc-avatar--photo"
            src={url}
            alt={name}
            onError={() => setBrokenSrc(url)}
          />
        ) : (
          initialOf(name)
        )}
      </div>
    </AuthorPhotoEdit>
  );
}

function AuthorHero({ author }: { author: AuthorPage }) {
  const navigate = useNavigate();
  const showInLibrary = () => {
    // A saved shelf pick outranks the library on the landing, and one without this author would show nothing.
    saveShelfSelection({ kind: "all" });
    const clauses: FilterClause[] = [
      { field: "author", mode: "include", values: [author.name] },
    ];
    navigate("/", { state: { clauses } });
  };
  return (
    <header className="au-hero">
      <AuthorAvatar
        id={author.id}
        name={author.name}
        hasPhoto={author.hasPhoto}
      />
      <div className="au-hero-body">
        <h2 className="au-name" data-testid="author-name">
          {author.name}
        </h2>
        <p className="au-meta" data-testid="author-meta">
          {heroMeta(author.bookCount, seriesCount(author.books))}
        </p>
      </div>
      <div className="au-hero-actions">
        <button
          type="button"
          className="au-btn"
          data-testid="author-show-in-library"
          onClick={showInLibrary}
        >
          Show in library
        </button>
        <AuthorMoreMenu author={author} />
      </div>
    </header>
  );
}

/** How far the reader is through an author: one bar, the three counts, and the book in progress with a Resume. */
function ReadingStrip({
  books,
  states,
}: {
  books: Book[];
  states: BookStates;
}) {
  if (books.length === 0) return null;
  const t = tally(books, states);
  const current = currentBook(books, states);
  return (
    <section className="au-reading" data-testid="author-reading">
      <div className="au-progress">
        <ProgressMeter total={books.length} counts={t} />
        <p className="au-tally">
          <span>
            <b>{t.finished}</b> finished
          </span>
          <span>
            <b>{t.reading}</b> reading
          </span>
          <span>
            <b>{t.unread}</b> unread
          </span>
        </p>
      </div>
      {current && (
        <BookCard
          book={current.book}
          meta={currentMeta(
            current.book,
            current.state,
            nowSecs(),
            -new Date().getTimezoneOffset() * 60,
          )}
          action="Resume"
          to={readerHref(
            current.book.uuid,
            current.book.formats,
            current.state.format,
            current.state.fileId,
          )}
          testid="author-current"
          actionTestid="author-resume"
        />
      )}
    </section>
  );
}

/** The author's books shelved by series, each under its name and a link to the series page, then everything outside a series. */
function AuthorShelves({
  books,
  states,
}: {
  books: Book[];
  states: BookStates;
}) {
  const { shelves, standalone } = groupBySeries(books);
  return (
    <div className="au-shelves">
      {shelves.map((shelf) => (
        <section key={`${shelf.id}-${shelf.name}`} className="au-shelf">
          <header className="au-shelf-head">
            <h3 className="au-shelf-title">{shelf.name}</h3>
            <span className="au-shelf-meta">
              {shelfMeta(shelf.books, states)}
            </span>
            {shelf.id !== null && (
              <Link
                to={`/series/${shelf.id}`}
                className="au-shelf-link"
                aria-label={`${shelf.name} series page`}
                data-testid="author-series-link"
              >
                Series page
              </Link>
            )}
          </header>
          <BookGrid books={shelf.books} states={states} />
        </section>
      ))}
      {standalone.length > 0 && (
        <section className="au-shelf">
          <header className="au-shelf-head">
            <h3 className="au-shelf-title">Other works</h3>
            <span className="au-shelf-meta">
              {shelfMeta(standalone, states)}
            </span>
          </header>
          <BookGrid books={standalone} states={states} />
        </section>
      )}
    </div>
  );
}

/** The author pane beside the authors list: who they are, how far the reader is through them, and their books by series. `preview` marks `/authors`' stand-in, which leaves the page title to the index. */
export function AuthorPane({
  id,
  preview = false,
}: {
  id: AuthorId;
  preview?: boolean;
}) {
  const author = useQuery({
    ...authorQuery(id),
    placeholderData: keepPreviousData,
  });
  const page = author.data;
  if (page) {
    // The accent of the first cover that has one tints the pane.
    const accent =
      page.books.find((b) => b.accent !== null)?.accent ?? "var(--accent)";
    return (
      // Another author kept on screen while this one loads stays, dimmed.
      <Stale stale={author.isPlaceholderData}>
        {!preview && <PageTitle page={page.name} />}
        <article
          key={page.id}
          className="au-pane"
          style={{ "--au-accent": accent }}
          data-testid="author-pane"
        >
          <AuthorHero author={page} />
          <ReadingStrip books={page.books} states={page.reading} />
          <AuthorShelves books={page.books} states={page.reading} />
        </article>
      </Stale>
    );
  }
  if (author.isError) {
    return (
      <PageError
        message={author.error.message}
        backTo="/authors"
        backLabel="Back to authors"
      />
    );
  }
  if (page === null && !author.isPlaceholderData) {
    return (
      <PageNotFound
        subject="Author"
        backTo="/authors"
        backLabel="Back to authors"
      />
    );
  }
  return <Loading kind="section" label="Finding the author" />;
}

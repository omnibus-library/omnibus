import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import {
  type FilterClause,
  type SeriesId,
  type SeriesPage,
  seriesQuery,
  utcOffsetMinutes,
} from "../../api";
import {
  BookCard,
  BookGrid,
  ProgressMeter,
} from "../../components/Browse/BookShelf";
import {
  type BookStates,
  shelfMeta,
  tally,
} from "../../components/Browse/bookStates";
import { CoverImage } from "../../components/Cover/CoverImage";
import { Loading, Stale } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { bookCount, initialOf, nowSecs } from "../../format";
import { saveShelfSelection } from "../../viewPrefs";
import {
  missingLabel,
  missingNumbers,
  nextAction,
  nextMeta,
  nextUp,
  seriesAuthors,
  tileCaption,
} from "./seriesProgress";
import "../../components/DiscPage/DiscPage.css";
import "./SeriesDetail.css";

/** Most covers the hero's fan shows. */
const STACK = 3;
/** Most authors the meta line names before "and 2 more". */
const NAMED_AUTHORS = 2;

/** The first covers fanned out, book one in front; the name's initial in their place for a series with no books. */
function CoverFan({
  books,
  name,
}: {
  books: SeriesPage["books"];
  name: string;
}) {
  if (books.length === 0) {
    return (
      <div className="disc-avatar au-avatar" aria-hidden="true">
        {initialOf(name)}
      </div>
    );
  }
  return (
    <div className="se-fan" aria-hidden="true">
      {books.slice(0, STACK).map((book) => (
        <div key={book.uuid} className="se-fan-cover">
          <CoverImage book={book} sizes="92px" />
        </div>
      ))}
    </div>
  );
}

function SeriesHero({ series }: { series: SeriesPage }) {
  const navigate = useNavigate();
  const authors = seriesAuthors(series.books);
  const named = authors.slice(0, NAMED_AUTHORS);
  const more = authors.length - named.length;
  const showInLibrary = () => {
    // A saved shelf pick outranks the library on the landing, and one without this series would show nothing.
    saveShelfSelection({ kind: "all" });
    const clauses: FilterClause[] = [
      { field: "series", mode: "include", values: [series.name] },
    ];
    navigate("/", { state: { clauses } });
  };
  return (
    <header className="au-hero">
      <CoverFan books={series.books} name={series.name} />
      <div className="au-hero-body">
        <h2 className="au-name" data-testid="series-name">
          {series.name}
        </h2>
        <p className="au-meta" data-testid="series-meta">
          {bookCount(series.bookCount)}
          {authors.length > 0 && " · by "}
          {named.map((author, i) => (
            <span key={author.name}>
              {i > 0 && ", "}
              {author.id === null ? (
                author.name
              ) : (
                <Link to={`/authors/${author.id}`} className="se-meta-link">
                  {author.name}
                </Link>
              )}
            </span>
          ))}
          {more > 0 && ` and ${more} more`}
        </p>
      </div>
      <div className="au-hero-actions">
        <button
          type="button"
          className="au-btn"
          data-testid="series-show-in-library"
          onClick={showInLibrary}
        >
          Show in library
        </button>
      </div>
    </header>
  );
}

/** How far the reader is through the series: one bar, the three counts, and the book to open next. */
function ReadingStrip({
  books,
  states,
}: {
  books: SeriesPage["books"];
  states: BookStates;
}) {
  if (books.length === 0) return null;
  const t = tally(books, states);
  const next = nextUp(books, states);
  const action = next && nextAction(next);
  return (
    <section className="au-reading" data-testid="series-reading">
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
      {next && action && (
        <BookCard
          book={next.book}
          meta={nextMeta(next, nowSecs(), utcOffsetMinutes() * 60)}
          action={action.label}
          to={action.to}
          testid={action.testid}
          actionTestid={action.actionTestid}
        />
      )}
    </section>
  );
}

/** Every book in reading order under a heading with how many the reader finished and which numbers are missing, or a note when the library holds none. */
function ReadingOrder({
  books,
  states,
  total,
}: {
  books: SeriesPage["books"];
  states: BookStates;
  total: number;
}) {
  // A series can outlive its last member, so say so rather than render a titled void.
  if (books.length === 0) {
    return (
      <p className="subtitle se-empty" data-testid="series-empty">
        No books in this series are in your library.
      </p>
    );
  }
  const gaps = missingLabel(missingNumbers(books));
  return (
    <section className="au-shelf">
      <header className="au-shelf-head">
        <h3 className="au-shelf-title">Reading order</h3>
        <span className="au-shelf-meta">
          {total > books.length
            ? `First ${books.length} of ${total} books`
            : shelfMeta(books, states)}
        </span>
        {gaps !== null && (
          <span className="au-shelf-meta se-gaps" data-testid="series-gaps">
            {gaps}
          </span>
        )}
      </header>
      <BookGrid books={books} states={states} caption={tileCaption} />
    </section>
  );
}

/** The series pane beside the series list: the series at a glance, how far the reader is through it, and its books in order. `preview` marks `/series`' stand-in, which leaves the page title and the way back to the index. */
export function SeriesPane({
  id,
  preview = false,
}: {
  id: SeriesId;
  preview?: boolean;
}) {
  const series = useQuery({
    ...seriesQuery(id),
    placeholderData: keepPreviousData,
  });
  const page = series.data;
  const back = preview
    ? { backTo: "/", backLabel: "Back to library" }
    : { backTo: "/series", backLabel: "Back to series" };
  if (page) {
    const accent =
      page.books.find((b) => b.accent !== null)?.accent ?? "var(--accent)";
    // Past the book cap the list arrives cut short, and a tally drawn from it would describe only part.
    const whole = page.books.length >= page.bookCount;
    return (
      // Another series kept on screen while this one loads stays, dimmed.
      <Stale stale={series.isPlaceholderData}>
        {!preview && <PageTitle page={page.name} />}
        <article
          key={page.id}
          className="au-pane"
          style={{ "--au-accent": accent }}
          data-testid="series-pane"
        >
          {!preview && (
            <Link to="/series" className="se-back" data-testid="series-back">
              ← All series
            </Link>
          )}
          <SeriesHero series={page} />
          {whole && <ReadingStrip books={page.books} states={page.reading} />}
          <ReadingOrder
            books={page.books}
            states={page.reading}
            total={page.bookCount}
          />
        </article>
      </Stale>
    );
  }
  if (series.isError) {
    return <PageError message={series.error.message} {...back} />;
  }
  if (page === null && !series.isPlaceholderData) {
    return <PageNotFound subject="Series" {...back} />;
  }
  return <Loading kind="section" label="Gathering the series" />;
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  authorBooksQuery,
  type Book,
  type BookDetail,
  isWishlistOnly,
  type Suggestion,
  seriesQuery,
  thumbSrcSet,
  thumbUrl,
} from "../../api";
import { Cover } from "../../components/Cover/Cover";
import { ChevronRightGlyph } from "../../components/Glyphs/Glyphs";
import { Loading, Ring } from "../../components/Loading/Loading";
import { bookCount, formatYear } from "../../format";
import {
  suggestionPollMs,
  suggestionsQuery,
  suggestionsUnavailable,
} from "./queries";
import "./Overview.css";

/** The series fan's id, where the byline's series scrolls to. */
export const SERIES_ID = "bp-series";

/** One cover, a title and a line under it, linking to its page. */
function Tile({
  to,
  cover,
  title,
  meta,
  testId,
  external = false,
}: {
  to: string;
  cover: ReactNode;
  title: string;
  meta: string | null;
  testId?: string;
  external?: boolean;
}) {
  const body = (
    <>
      <span className="bp-tile-cover">{cover}</span>
      <span className="bp-tile-title">{title}</span>
      {meta && <span className="bp-tile-meta">{meta}</span>}
    </>
  );
  return external ? (
    <a
      className="bp-tile"
      href={to}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
    >
      {body}
    </a>
  ) : (
    <Link className="bp-tile" to={to} data-testid={testId}>
      {body}
    </Link>
  );
}

/** A library book's cover at the page's one cover size, its plate when it has none. */
const bookCover = (book: Book) => (
  <Cover
    book={book}
    src={book.hasCover ? thumbUrl(book.uuid) : null}
    srcSet={book.hasCover ? thumbSrcSet(book.uuid) : undefined}
  />
);

/** The series' covers stacked and fanned, spreading when the reader reaches for them, in reading order. */
function SeriesFan({ book, seriesId }: { book: BookDetail; seriesId: number }) {
  const series = useQuery(seriesQuery(book.seriesId));
  const books = series.data?.books ?? [];
  const at = books.findIndex((b) => b.uuid === book.uuid);
  const next = at >= 0 ? books[at + 1] : undefined;
  const name = book.series?.name ?? series.data?.name ?? "";
  const seriesPage = (
    <Link to={`/series/${seriesId}`} className="bp-link-row">
      Series page
      <ChevronRightGlyph size={16} />
    </Link>
  );
  return (
    <section id={SERIES_ID} aria-labelledby="bp-series-title">
      <div className="bp-section-head">
        <h2 id="bp-series-title">{name} series</h2>
        {seriesPage}
      </div>
      {series.data ? (
        <>
          <ol
            className="bp-fan"
            aria-label={`${name} series`}
            data-testid="bp-series-fan"
          >
            {books.map((item, i) => (
              <li key={item.uuid} className="bp-fan-card" style={{ "--i": i }}>
                <Link
                  to={`/books/${item.uuid}`}
                  aria-current={i === at ? "page" : undefined}
                >
                  <span className="bp-tile-cover">{bookCover(item)}</span>
                  <span className="bp-tile-title">{item.title}</span>
                  <span className="bp-tile-meta">
                    {[
                      item.series?.index && `Book ${item.series.index}`,
                      i === at && "This book",
                      next && i === at + 1 && "Up next",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {series.data.bookCount > 0 && (
            <p className="bp-fan-caption">
              {bookCount(series.data.bookCount)} in your library
              {next && ` · ${next.title} is up next`}
            </p>
          )}
        </>
      ) : series.isError || series.data === null ? (
        <p className="bp-quiet" data-testid="bp-series-unavailable">
          The series didn’t load — {seriesPage}
        </p>
      ) : (
        <Loading
          kind="section"
          className="start"
          label="Gathering the series"
        />
      )}
    </section>
  );
}

/** The author's other books in the library, up to four, with a link to their page; nothing until there is one. */
function MoreBy({ book }: { book: BookDetail }) {
  const author = book.authors[0] ?? "";
  const id = isWishlistOnly(book) ? null : (book.creators[0]?.id ?? null);
  const page = useQuery(authorBooksQuery(id));
  // The author's page is the source; without one read, or an author it doesn't know, there is nothing to list.
  const others = (page.data ?? []).filter((b) => b.uuid !== book.uuid);
  if (id === null || others.length === 0) return null;
  return (
    <section aria-labelledby="bp-more-by-title">
      <div className="bp-section-head">
        <h2 id="bp-more-by-title">More by {author}</h2>
        <Link to={`/authors/${id}`} className="bp-link-row">
          Author page
          <ChevronRightGlyph size={16} />
        </Link>
      </div>
      <ul className="bp-shelf" data-testid="bp-more-by">
        {others.slice(0, 4).map((other) => (
          <li key={other.uuid}>
            <Tile
              to={`/books/${other.uuid}`}
              cover={bookCover(other)}
              title={other.title}
              meta={(other.published && formatYear(other.published)) || null}
              testId="bp-more-by-tile"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Hardcover's read-alikes, in one row that scrolls sideways. Nothing unless the server has some, is still looking, or gave up. */
function Suggestions({ book }: { book: BookDetail }) {
  const client = useQueryClient();
  const { queryKey } = suggestionsQuery(book.uuid);
  const answer = useQuery(suggestionsQuery(book.uuid)).data;
  const answers = client.getQueryState(queryKey)?.dataUpdateCount ?? 0;
  const searching = suggestionPollMs(answer, answers) !== false;
  const unavailable = suggestionsUnavailable(answer, answers);
  if (
    !searching &&
    !unavailable &&
    !(answer?.status === "ready" && answer.items.length > 0)
  )
    return null;
  return (
    <section data-testid="suggestions-strip" aria-labelledby="bp-suggest-title">
      <div className="bp-section-head">
        <h2 id="bp-suggest-title">
          Readers who finished {book.title} also read
        </h2>
        <span className="bp-head-note">From Hardcover</span>
      </div>
      {answer?.status === "ready" ? (
        <ul className="bp-shelf bp-suggest-row">
          {answer.items.map((s: Suggestion) => (
            <li key={s.id}>
              <Tile
                to={s.hardcoverUrl}
                external
                cover={
                  <Cover
                    book={{ title: s.title, authors: [s.author], accent: null }}
                    src={s.cover}
                  />
                }
                title={s.title}
                meta={s.author}
                testId="suggestion-card"
              />
            </li>
          ))}
        </ul>
      ) : unavailable ? (
        <p className="bp-quiet" data-testid="suggestions-unavailable">
          Suggestions are unavailable right now.
        </p>
      ) : (
        <div className="bp-suggest-pending" data-testid="suggestions-pending">
          <Ring />
          <p className="bp-quiet">Looking for read-alikes via Hardcover…</p>
        </div>
      )}
    </section>
  );
}

/** The books around this one: its series, the author's others, and what readers of it went on to read. */
export function Related({ book }: { book: BookDetail }) {
  return (
    <div className="bp-related" data-testid="bp-related">
      <div className="bp-split-shelf">
        {book.seriesId !== null && (
          <SeriesFan book={book} seriesId={book.seriesId} />
        )}
        <MoreBy book={book} />
      </div>
      <Suggestions book={book} />
    </div>
  );
}

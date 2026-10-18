import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { type Book, fetchBookPage, thumbSrcSet, thumbUrl } from "../api";
import { BusyLabel, Cover } from "../atrium";

const TILE_SIZES = "(max-width: 640px) 160px, (max-width: 1280px) 200px, 240px";
const SKELETON_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// The entrance cascade: 40ms steps, wrapping every eight tiles.
const staggerMs = (index: number) => (index % 8) * 40;

function Tile({ book, index }: { book: Book; index: number }) {
  return (
    <Link
      to={`/books/${book.uuid}`}
      className="cover-link lib-tile"
      style={{ animationDelay: `${staggerMs(index)}ms` }}
      aria-label={`Open details for ${book.title}`}
    >
      <span className="lib-tile-art">
        <Cover
          book={book}
          src={book.hasCover ? thumbUrl(book.uuid) : null}
          srcSet={book.hasCover ? thumbSrcSet(book.uuid) : undefined}
          sizes={TILE_SIZES}
        />
      </span>
      <span className="lib-tile-cap">
        <span className="lib-tile-title">{book.title}</span>
        {book.authors.length > 0 && (
          <span className="lib-tile-author">{book.authors.join(", ")}</span>
        )}
      </span>
    </Link>
  );
}

function Skeletons() {
  return (
    <div className="lib-loading" role="status" aria-live="polite">
      <span className="ld-sr">Taking the books off the shelf</span>
      <div className="ld-covers" aria-hidden="true">
        {SKELETON_CELLS.map((i) => (
          <div key={i} className="ld-covers-cell">
            <span className="ld-skel cover" style={{ "--i": i }} />
            <span className="ld-skel line" style={{ "--i": i }} />
            <span className="ld-skel line" style={{ "--i": i }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Count({ total }: { total: number | null }) {
  if (total === null) {
    return (
      <span className="lib-header-count">
        {" · "}
        <span className="ld-sheen">counting</span>
      </span>
    );
  }
  return (
    <span className="lib-header-count">
      {` · ${total} ${total === 1 ? "book" : "books"}`}
    </span>
  );
}

export function Library() {
  const pages = useInfiniteQuery({
    queryKey: ["books"],
    queryFn: ({ pageParam }) => fetchBookPage(pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const books = pages.data?.pages.flatMap((page) => page.books) ?? [];
  const total = pages.data?.pages[0]?.total ?? null;

  return (
    <div className="landing-col lmq" id="lmq-root">
      <header className="lib-header">
        <div className="lib-header-kicker">
          <h1 className="label lib-header-kicker-title">Your Library</h1>
        </div>
        <div className="lib-header-row">
          <div className="lib-header-title-wrap">
            <p className="lib-header-title">
              <em>All Books</em>
              <Count total={total} />
            </p>
          </div>
        </div>
      </header>
      <div className="lib-layout lib-layout--collapsed">
        <div className="lib-main lib-books">
          {pages.status === "pending" && <Skeletons />}
          {pages.status === "error" && (
            <p className="library-empty" role="alert">
              Couldn't load the library: {pages.error.message}
            </p>
          )}
          {pages.status === "success" && books.length === 0 && (
            <p className="library-empty">
              No books yet. Point Settings at a library.
            </p>
          )}
          {books.length > 0 && (
            <div className="lib-grid">
              {books.map((book, index) => (
                <Tile key={book.uuid} book={book} index={index} />
              ))}
            </div>
          )}
          {pages.hasNextPage && (
            <div className="lib-load-more-row">
              <button
                type="button"
                className="btn lib-load-more"
                onClick={() => pages.fetchNextPage()}
                disabled={pages.isFetchingNextPage}
                aria-busy={pages.isFetchingNextPage}
              >
                <BusyLabel
                  busy={pages.isFetchingNextPage}
                  label="Load more"
                  busyLabel="Loading more…"
                />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

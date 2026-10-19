import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  type Book,
  fetchBookPage,
  type LibraryQuery,
  thumbSrcSet,
  thumbUrl,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import type { ShelfList } from "../../components/FilterBar/filters";
import {
  BusyLabel,
  CoverSkeletons,
  RowSkeletons,
} from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { plural } from "../../format";
import { useCurrentUser } from "../../session";
import {
  DEFAULT_PREFS,
  lastLibrary,
  loadPrefs,
  type Prefs,
  reconcile,
  savePlan,
  savePrefs,
} from "../../viewPrefs";
import { BookTable } from "./BookTable";
import { emptyState, headerCount } from "./libraryView";
import { headerSort } from "./sorting";
import { Toolbar } from "./Toolbar";
import "./Library.css";

const TILE_SIZES = "(max-width: 640px) 160px, (max-width: 1280px) 200px, 240px";

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

// The shelf list arrives with the shelves row; until then the Shelf facet waits.
const SHELVES: ShelfList = { state: "pending" };

function Receipt({
  count,
  hidden,
}: {
  count: number | "counting" | null;
  hidden: number | null;
}) {
  const hiddenBooks = hidden !== null && hidden > 0 ? hidden : null;
  if (count === null && hiddenBooks === null) return null;
  return (
    <div className="lib-header-receipt">
      <p className="lib-header-receipt-text">
        {count === "counting" && (
          <span className="lib-header-count">
            <span className="ld-sheen">counting</span>
          </span>
        )}
        {typeof count === "number" && (
          <span className="lib-header-count">
            {count} book{plural(count)}
          </span>
        )}
        {hiddenBooks !== null && (
          <span className="lib-header-hidden">{hiddenBooks} hidden</span>
        )}
      </p>
    </div>
  );
}

export function Library() {
  const user = useCurrentUser();
  const [prefs, setPrefs] = useState(() => {
    const last = lastLibrary();
    return last ? loadPrefs(last) : DEFAULT_PREFS;
  });
  const query: LibraryQuery = {
    sort: prefs.sort,
    dir: prefs.dir,
    clauses: prefs.clauses,
    excludeFormats: [...user.hiddenFormats].sort(),
  };
  const pages = useInfiniteQuery({
    queryKey: ["books", query],
    queryFn: ({ pageParam }) => fetchBookPage(query, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const books = pages.data?.pages.flatMap((page) => page.books) ?? [];
  const firstPage = pages.data?.pages[0];
  const filtered = prefs.clauses.length > 0;

  // Page 1 names the library; until it does, `lastLibrary()` is only a guess.
  const answeredPath = firstPage?.path;
  const libraryPath = useRef<string | null>(null);
  const reconciled = useRef<string | null>(null);
  const unsaved = useRef(false);
  useEffect(() => {
    if (answeredPath === undefined) return;
    libraryPath.current = answeredPath;
    if (answeredPath === null) return;
    const action = reconcile(reconciled.current, answeredPath, unsaved.current);
    if (action === "adopt") setPrefs(loadPrefs(answeredPath));
    if (action === "save") {
      savePrefs(answeredPath, prefs);
      unsaved.current = false;
    }
    reconciled.current = answeredPath;
  }, [answeredPath, prefs]);

  // Fetch the next page as the button nears the viewport.
  const loadMore = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  useEffect(() => {
    const row = loadMore.current;
    if (!row || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && fetchNextPage(),
      { rootMargin: "400px" },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const change = (next: Prefs) => {
    const plan = savePlan(libraryPath.current, pages.isError, lastLibrary());
    if (plan.writeTo) savePrefs(plan.writeTo, next);
    if (plan.unsaved) unsaved.current = true;
    setPrefs(next);
  };

  return (
    <div className="landing-col lmq" id="lmq-root">
      <PageTitle />
      <header className="lib-header">
        <h1 className="sr-only">Your Library</h1>
        <div className="lib-header-row">
          <FilterBar
            clauses={prefs.clauses}
            shelves={SHELVES}
            viewerId={user.id}
            onChange={(clauses) => change({ ...prefs, clauses })}
          />
          <Receipt
            count={headerCount(
              filtered,
              firstPage?.total ?? null,
              pages.isError,
            )}
            hidden={firstPage?.hidden ?? null}
          />
          <Toolbar
            prefs={prefs}
            hiddenFormats={query.excludeFormats}
            onChange={change}
          />
        </div>
        {answeredPath === null && (
          <p className="lib-header-hint">
            Configure your ebook library path in Administration › Sources.
          </p>
        )}
      </header>
      <div className="lib-layout lib-layout--collapsed">
        <div className="lib-main lib-books">
          {pages.status === "pending" && (
            <div className="lib-loading" role="status" aria-live="polite">
              <span className="ld-sr">Taking the books off the shelf</span>
              {prefs.view === "table" ? (
                <RowSkeletons count={8} avatar={false} />
              ) : (
                <CoverSkeletons />
              )}
            </div>
          )}
          {pages.status === "error" && (
            <PageError
              message={`Couldn't load the library: ${pages.error.message}`}
            />
          )}
          {pages.status === "success" &&
            emptyState(books.length, filtered) === "empty" && (
              <p className="library-empty">No ebooks found.</p>
            )}
          {pages.status === "success" &&
            emptyState(books.length, filtered) === "filtered" && (
              <div className="library-empty">
                <p>No books match these filters.</p>
                <Button onClick={() => change({ ...prefs, clauses: [] })}>
                  Clear filters
                </Button>
              </div>
            )}
          {books.length > 0 &&
            (prefs.view === "table" ? (
              <BookTable
                books={books}
                prefs={prefs}
                onSort={(key) =>
                  change({ ...prefs, ...headerSort(prefs, key) })
                }
              />
            ) : (
              <div className="lib-grid">
                {books.map((book, index) => (
                  <Tile key={book.uuid} book={book} index={index} />
                ))}
              </div>
            ))}
          {pages.hasNextPage && (
            <div className="lib-load-more-row" ref={loadMore}>
              <Button
                className="lib-load-more"
                onClick={() => pages.fetchNextPage()}
                disabled={pages.isFetchingNextPage}
                aria-busy={pages.isFetchingNextPage}
              >
                <BusyLabel
                  busy={pages.isFetchingNextPage}
                  label="Load more"
                  busyLabel="Loading more…"
                />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

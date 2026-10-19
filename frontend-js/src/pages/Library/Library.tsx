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
import { BusyLabel, CoverSkeletons } from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  DEFAULT_PREFS,
  lastLibrary,
  loadPrefs,
  type Prefs,
  reconcile,
  savePlan,
  savePrefs,
} from "../../viewPrefs";
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

export function Library() {
  const [prefs, setPrefs] = useState(() => {
    const last = lastLibrary();
    return last ? loadPrefs(last) : DEFAULT_PREFS;
  });
  const query: LibraryQuery = { sort: prefs.sort, dir: prefs.dir };
  const pages = useInfiniteQuery({
    queryKey: ["books", query],
    queryFn: ({ pageParam }) => fetchBookPage(query, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const books = pages.data?.pages.flatMap((page) => page.books) ?? [];

  // Page 1 names the library; until it does, `lastLibrary()` is only a guess.
  const answeredPath = pages.data?.pages[0]?.path;
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
          <Toolbar prefs={prefs} onChange={change} />
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
              <CoverSkeletons />
            </div>
          )}
          {pages.status === "error" && (
            <PageError
              message={`Couldn't load the library: ${pages.error.message}`}
            />
          )}
          {pages.status === "success" && books.length === 0 && (
            <p className="library-empty">No ebooks found.</p>
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

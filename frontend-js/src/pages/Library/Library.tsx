import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchBookPage, type LibraryQuery } from "../../api";
import { Button } from "../../components/Button/Button";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import {
  BusyLabel,
  CoverSkeletons,
  RowSkeletons,
} from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { bookCount } from "../../format";
import { useCurrentUser } from "../../session";
import { useLibraryPrefs } from "../../viewPrefs";
import { BookGrid } from "./BookGrid";
import { BookTable } from "./BookTable";
import { BulkEditBar, BulkEditModal, BulkShelfPicker } from "./BulkEdit";
import { useBulkSelection } from "./bulkEdit";
import { emptyState, headerCount } from "./libraryView";
import {
  EdgeResume,
  leadAccent,
  ResumeStack,
  ResumeStackPending,
  useResumeLead,
} from "./ResumeStack";
import { ShelfGallery } from "./ShelfGallery";
import { useShelfLens } from "./shelfGallery";
import { headerSort } from "./sorting";
import { Toolbar } from "./Toolbar";
import { useLoadMore } from "./useLoadMore";
import "./Library.css";

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
          <span className="lib-header-count">{bookCount(count)}</span>
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
  const { prefs, change, noteAnswered } = useLibraryPrefs();
  const query: LibraryQuery = {
    sort: prefs.sort,
    dir: prefs.dir,
    clauses: prefs.clauses,
    excludeFormats: [...user.hiddenFormats].sort(),
    stackSeries: user.stackSeries && prefs.view === "grid",
  };
  const pages = useInfiniteQuery({
    queryKey: ["books", query],
    queryFn: ({ pageParam }) => fetchBookPage(query, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const browseBooks = pages.data?.pages.flatMap((page) => page.books) ?? [];
  const firstPage = pages.data?.pages[0];
  const filtered = prefs.clauses.length > 0;
  const answeredPath = firstPage?.path;
  useEffect(
    () => noteAnswered(answeredPath, pages.isError),
    [noteAnswered, answeredPath, pages.isError],
  );

  const { points, lead, leadPoint, pending, setLeadKey, past } =
    useResumeLead();
  const { selection, pick, shelfId, shelfPage, sortLock } = useShelfLens(prefs);
  // The lens is the shelf's page or, on All Books, the browse list.
  const lens = shelfId === null ? pages : shelfPage;
  const books = shelfId === null ? browseBooks : (shelfPage.data ?? []);
  // shortcut: shelf lens stays unstacked; port shared::stack_books when parity is wanted
  const stacks = pages.data?.pages.flatMap((page) => page.stacks) ?? [];
  const empty = emptyState(books.length, filtered);

  // Bulk edit is the admin's, on the table.
  const bulk = user.isAdmin && prefs.view === "table";
  const selectAll = useRef<HTMLInputElement>(null);
  const picked = useBulkSelection(
    JSON.stringify([query, shelfId, prefs.view]),
    books,
  );

  const hasNextPage = shelfId === null && pages.hasNextPage;
  const loadMore = useLoadMore(pages, hasNextPage);

  return (
    <div
      className={past ? "landing-col lmq lmq--past" : "landing-col lmq"}
      id="lmq-root"
      style={leadAccent(leadPoint)}
    >
      <PageTitle />
      {leadPoint ? (
        <ResumeStack points={points} lead={lead} onLead={setLeadKey} />
      ) : (
        pending && <ResumeStackPending />
      )}
      <ShelfGallery
        selection={selection}
        pickedCount={
          shelfId !== null && !filtered && shelfPage.data
            ? shelfPage.data.length
            : null
        }
        allCount={firstPage?.total ?? null}
        allCovers={browseBooks
          .filter((b) => b.hasCover)
          .slice(0, 4)
          .map((b) => b.uuid)}
        onSelect={pick}
      />
      <header className="lib-header">
        <h1 className="sr-only">Your Library</h1>
        <div className="lib-header-row">
          <FilterBar
            clauses={prefs.clauses}
            onChange={(clauses) => change({ ...prefs, clauses })}
          />
          <Receipt
            count={headerCount(
              filtered,
              shelfId === null
                ? (firstPage?.total ?? null)
                : (shelfPage.data?.length ?? null),
              lens.isError,
            )}
            hidden={shelfId === null ? (firstPage?.hidden ?? null) : null}
          />
          <Toolbar
            prefs={prefs}
            // Hidden formats narrow All Books only.
            hiddenFormats={shelfId === null ? query.excludeFormats : []}
            sortLock={sortLock}
            stackable={shelfId === null}
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
          {lens.status === "pending" && (
            <div className="lib-loading" role="status" aria-live="polite">
              <span className="ld-sr">Taking the books off the shelf</span>
              {prefs.view === "table" ? (
                <RowSkeletons count={8} avatar={false} />
              ) : (
                <CoverSkeletons />
              )}
            </div>
          )}
          {lens.status === "error" && !lens.data && (
            <PageError
              message={`Couldn't load the library: ${lens.error.message}`}
            />
          )}
          {lens.isRefetchError && !pages.isFetchNextPageError && (
            <p className="subtitle" role="alert">
              Couldn't refresh the library: {lens.error?.message}
            </p>
          )}
          {lens.data && empty === "empty" && (
            <p className="library-empty">
              {shelfId === null
                ? "No ebooks found."
                : "No books in this shelf."}
            </p>
          )}
          {lens.data && empty === "filtered" && (
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
                sortLock={sortLock}
                selectAllRef={selectAll}
                onSort={(key) =>
                  change({ ...prefs, ...headerSort(prefs, key) })
                }
                select={
                  bulk
                    ? { selected: picked.selected, onChange: picked.select }
                    : undefined
                }
              />
            ) : (
              <BookGrid books={books} stacks={shelfId === null ? stacks : []} />
            ))}
          {hasNextPage && (
            <div className="lib-load-more-row" ref={loadMore}>
              {pages.isFetchNextPageError && pages.error && (
                <p className="subtitle" role="alert">
                  Couldn't load more: {pages.error.message}
                </p>
              )}
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
      {bulk && picked.chosen.length > 0 && (
        <BulkEditBar
          count={picked.chosen.length}
          onEdit={() => picked.setEditing(true)}
          onAddToShelf={() => picked.setFiling(true)}
          onClear={picked.clear}
        />
      )}
      {picked.editing && picked.chosen.length > 0 && (
        <BulkEditModal
          books={picked.chosen}
          fallbackFocus={selectAll}
          onClose={() => picked.setEditing(false)}
          onSaved={() => {
            picked.setEditing(false);
            picked.clear();
          }}
        />
      )}
      {picked.filing && picked.chosen.length > 0 && (
        <BulkShelfPicker
          books={picked.chosen}
          fallbackFocus={selectAll}
          onClose={() => picked.setFiling(false)}
          onAdded={() => {
            picked.setFiling(false);
            picked.clear();
          }}
        />
      )}
      {leadPoint && <EdgeResume point={leadPoint} past={past} />}
    </div>
  );
}

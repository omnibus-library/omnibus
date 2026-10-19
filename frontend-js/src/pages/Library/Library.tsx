import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  fetchBookPage,
  fetchRecentProgress,
  fetchShelfPage,
  fetchShelves,
  type LibraryQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
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
import { useCurrentUser, useStackSeries } from "../../session";
import {
  DEFAULT_PREFS,
  lastLibrary,
  loadPrefs,
  loadShelfSelection,
  type Prefs,
  reconcile,
  type ShelfSelection,
  savePlan,
  savePrefs,
  saveShelfSelection,
} from "../../viewPrefs";
import { BookGrid } from "./BookGrid";
import { BookTable } from "./BookTable";
import { BulkEditBar, BulkEditModal, BulkShelfPicker } from "./BulkEdit";
import { emptyState, headerCount } from "./libraryView";
import {
  EdgeResume,
  leadAccent,
  ResumeStack,
  ResumeStackPending,
} from "./ResumeStack";
import { ShelfGallery } from "./ShelfGallery";
import { headerSort, sortLockReason } from "./sorting";
import { Toolbar } from "./Toolbar";
import "./Library.css";

const RESUME_POINTS = 5;
const PAST_STACK_PX = 240;

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
    stackSeries: user.stackSeries && prefs.view === "grid",
  };
  const stackToggle = useStackSeries();
  const pages = useInfiniteQuery({
    queryKey: ["books", query],
    queryFn: ({ pageParam }) => fetchBookPage(query, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const browseBooks = pages.data?.pages.flatMap((page) => page.books) ?? [];
  const firstPage = pages.data?.pages[0];
  const filtered = prefs.clauses.length > 0;

  // The books you have open; a failed feed settles to none, which hides the stack.
  const recent = useQuery({
    queryKey: ["progress", "recent", RESUME_POINTS],
    queryFn: () => fetchRecentProgress(RESUME_POINTS),
  });
  const points = recent.data ?? [];
  // Keyed, so a refetch that reorders the feed keeps the book the reader brought forward.
  const [leadKey, setLeadKey] = useState<string | null>(null);
  const lead = Math.max(
    points.findIndex((point) => point.key === leadKey),
    0,
  );
  const leadPoint = points[lead];

  // Past this much scroll the stack is off-screen, so the edge ribbon takes over.
  const [past, setPast] = useState(false);
  useEffect(() => {
    const paint = () => setPast(window.scrollY > PAST_STACK_PX);
    paint();
    window.addEventListener("scroll", paint, { passive: true });
    return () => window.removeEventListener("scroll", paint);
  }, []);

  const [selection, setSelection] = useState(loadShelfSelection);
  const shelfId = selection.kind === "shelf" ? selection.id : null;
  const shelvesQuery = useQuery({
    queryKey: ["shelves"],
    queryFn: fetchShelves,
  });
  const shelves: ShelfList = shelvesQuery.data
    ? { state: "loaded", shelves: shelvesQuery.data }
    : shelvesQuery.isError
      ? { state: "failed" }
      : { state: "pending" };
  const shelfQuery = {
    sort: prefs.sort,
    dir: prefs.dir,
    clauses: prefs.clauses,
  };
  const shelfPage = useQuery({
    queryKey: ["shelf-page", shelfId, shelfQuery],
    queryFn:
      shelfId === null ? skipToken : () => fetchShelfPage(shelfId, shelfQuery),
  });
  // The lens is the shelf's page or, on All Books, the browse list.
  const lens = shelfId === null ? pages : shelfPage;
  const books = shelfId === null ? browseBooks : (shelfPage.data ?? []);
  // shortcut: shelf lens stays unstacked; port shared::stack_books when parity is wanted
  const stacks = pages.data?.pages.flatMap((page) => page.stacks) ?? [];
  const sortLock = sortLockReason(
    shelvesQuery.data?.find((s) => s.id === shelfId)?.kind ?? null,
  );

  // Bulk edit is the admin's, on the table; the checks belong to the list they were made on.
  const bulk = user.isAdmin && prefs.view === "table";
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [filing, setFiling] = useState(false);
  const listing = JSON.stringify([query, shelfId, prefs.view]);
  const [selectedIn, setSelectedIn] = useState(listing);
  if (selectedIn !== listing) {
    setSelectedIn(listing);
    setSelected(new Set());
    setEditing(false);
    setFiling(false);
  }
  const chosen = books.filter((book) => selected.has(book.uuid));
  const select = (uuids: string[], checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const uuid of uuids) {
        if (checked) next.add(uuid);
        else next.delete(uuid);
      }
      return next;
    });

  // A stored shelf the list no longer holds snaps back to All, judged only against a list that loaded.
  const loadedShelves = shelvesQuery.data;
  useEffect(() => {
    if (shelfId === null || !loadedShelves) return;
    if (loadedShelves.some((s) => s.id === shelfId)) return;
    setSelection({ kind: "all" });
    saveShelfSelection({ kind: "all" });
  }, [shelfId, loadedShelves]);
  const pick = (next: ShelfSelection) => {
    setSelection(next);
    saveShelfSelection(next);
  };

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
  const { isFetchingNextPage, isFetchNextPageError, fetchNextPage } = pages;
  const hasNextPage = shelfId === null && pages.hasNextPage;
  useEffect(() => {
    const row = loadMore.current;
    // After a failed page the button is the retry; re-arming here would refetch it in a loop.
    if (!row || !hasNextPage || isFetchingNextPage || isFetchNextPageError) {
      return;
    }
    const observer = new IntersectionObserver(
      // Entries queue while the page is busy, so a stale "not yet" can precede the current one.
      (entries) =>
        entries.some((entry) => entry.isIntersecting) && fetchNextPage(),
      { rootMargin: "400px" },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const change = (next: Prefs) => {
    const plan = savePlan(libraryPath.current, pages.isError, lastLibrary());
    if (plan.writeTo) savePrefs(plan.writeTo, next);
    if (plan.unsaved) unsaved.current = true;
    setPrefs(next);
  };

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
        recent.isPending && <ResumeStackPending />
      )}
      <ShelfGallery
        shelves={shelves}
        viewerId={user.id}
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
            shelves={shelves}
            viewerId={user.id}
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
            stack={{
              on: user.stackSeries,
              pending: stackToggle.isPending,
              failed: stackToggle.isError,
              onToggle: () => stackToggle.mutate(!user.stackSeries),
            }}
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
          {lens.status === "success" &&
            emptyState(books.length, filtered) === "empty" && (
              <p className="library-empty">
                {shelfId === null
                  ? "No ebooks found."
                  : "No books in this shelf."}
              </p>
            )}
          {lens.status === "success" &&
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
                sortLock={sortLock}
                onSort={(key) =>
                  change({ ...prefs, ...headerSort(prefs, key) })
                }
                select={bulk ? { selected, onChange: select } : undefined}
              />
            ) : (
              <BookGrid books={books} stacks={shelfId === null ? stacks : []} />
            ))}
          {hasNextPage && (
            <div className="lib-load-more-row" ref={loadMore}>
              {isFetchNextPageError && pages.error && (
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
      {bulk && chosen.length > 0 && (
        <BulkEditBar
          count={chosen.length}
          onEdit={() => setEditing(true)}
          onAddToShelf={() => setFiling(true)}
          onClear={() => setSelected(new Set())}
        />
      )}
      {editing && chosen.length > 0 && (
        <BulkEditModal
          books={chosen}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSelected(new Set());
          }}
        />
      )}
      {filing && chosen.length > 0 && (
        <BulkShelfPicker
          books={chosen}
          onClose={() => setFiling(false)}
          onAdded={() => {
            setFiling(false);
            setSelected(new Set());
          }}
        />
      )}
      {leadPoint && <EdgeResume point={leadPoint} />}
    </div>
  );
}

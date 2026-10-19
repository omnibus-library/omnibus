import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type Book,
  fetchBookPage,
  type LibraryQuery,
  searchBooks,
} from "../../api";
import { useDebounced } from "../../useDebounced";
import { useLoadMore } from "../../useLoadMore";
import { Button } from "../Button/Button";
import { CoverImage } from "../Cover/CoverImage";
import { CheckGlyph, SearchGlyph, XGlyph } from "../Glyphs/Glyphs";
import { BusyLabel, Skeleton } from "../Loading/Loading";
import { emptyMessage, statusLine, toggled } from "./picker";
import "../ShelfPicker/ShelfPicker.css";
import "./LibraryPicker.css";

// The picker is a find-this-book surface, not the reader's configured library view.
const BROWSE: LibraryQuery = {
  sort: "title",
  dir: "asc",
  clauses: [],
  excludeFormats: [],
  stackSeries: false,
};

function PickCard({
  book,
  picked,
  onShelf,
  onToggle,
}: {
  book: Book;
  picked: boolean;
  onShelf: boolean;
  onToggle: () => void;
}) {
  const format = book.formats[0];
  return (
    <button
      type="button"
      className="pick-card"
      data-testid={`picker-tile-${book.uuid}`}
      aria-pressed={picked}
      aria-disabled={onShelf}
      onClick={() => {
        if (!onShelf) onToggle();
      }}
    >
      <span className="pick-cover">
        <CoverImage book={book} sizes="44px" />
      </span>
      <span className="pick-meta">
        <span className="pick-name">{book.title}</span>
        {book.authors[0] && (
          <span className="pick-author">{book.authors[0]}</span>
        )}
        <span className="pick-tags">
          {onShelf ? (
            <span className="pick-on-shelf">On this shelf</span>
          ) : (
            format && <span className="pick-tag">{format}</span>
          )}
        </span>
      </span>
      <span className="pick-check" aria-hidden="true">
        {picked && <CheckGlyph />}
      </span>
    </button>
  );
}

function SkeletonCards() {
  return (
    <div className="pick-grid" data-testid="picker-loading" aria-hidden="true">
      {[...Array(8).keys()].map((i) => (
        <div key={i} className="pick-card pick-card-skel">
          <Skeleton shape="cover" index={i} />
          <span className="pick-meta">
            <Skeleton index={i} style={{ "--w": `${62 + ((i * 29) % 30)}%` }} />
            <Skeleton index={i} style={{ "--w": "44%", height: ".7em" }} />
          </span>
        </div>
      ))}
    </div>
  );
}

type LibraryPickerProps = {
  picked: readonly Book[];
  onPicked: (picked: Book[]) => void;
  /** The uuids the target shelf holds: drawn as members, not choices. */
  already: ReadonlySet<string>;
  /** Names the search box for its host modal. */
  searchTestId: string;
  autoFocus?: boolean;
};

/** A searchable card grid over the whole library, for picking books to put on a shelf. */
export function LibraryPicker({
  picked,
  onPicked,
  already,
  searchTestId,
  autoFocus = false,
}: LibraryPickerProps) {
  const [text, setText] = useState("");
  const [reviewing, setReviewing] = useState(false);
  // Clearing the box puts the library back at once; only a typed query waits.
  const typed = text.trim();
  const settled = useDebounced(text).trim();
  const query = typed === "" ? "" : settled;
  const searching = query !== "";

  const browse = useInfiniteQuery({
    queryKey: ["picker", "browse"],
    queryFn: ({ pageParam }) => fetchBookPage(BROWSE, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: !searching,
    // A stale infinite query refetches every page in turn on remount.
    staleTime: 60_000,
  });
  const search = useQuery({
    queryKey: ["picker", "search", query],
    queryFn: ({ signal }) => searchBooks(query, signal),
    enabled: searching,
  });
  const feed = searching ? search : browse;
  const found = searching
    ? search.data?.books
    : browse.data?.pages.flatMap((page) => page.books);
  const total = searching ? search.data?.total : browse.data?.pages[0]?.total;
  const rows = (reviewing ? picked : found) ?? [];
  const hasMore = !searching && !reviewing && browse.hasNextPage;
  const loadMore = useLoadMore(browse, hasMore);
  // The query is still settling while the typed text and the one searched differ.
  const pending = !reviewing && (typed !== query || feed.isPending);
  const chosen = new Set(picked.map((b) => b.uuid));

  return (
    <div className="pick">
      <div className="pick-search-row">
        <div className="pick-search">
          <SearchGlyph size={14} />
          <input
            type="search"
            placeholder="Search by title or author…"
            aria-label="Search your library"
            data-testid={searchTestId}
            value={text}
            // biome-ignore lint/a11y/noAutofocus: the host dialog exists to be typed into
            autoFocus={autoFocus}
            onChange={(e) => setText(e.target.value)}
          />
          {text !== "" && (
            <button
              type="button"
              className="pick-search-clear"
              aria-label="Clear search"
              data-testid="picker-clear-search"
              onClick={() => setText("")}
            >
              <XGlyph size={12} />
            </button>
          )}
        </div>
        {(picked.length > 0 || reviewing) && (
          <button
            type="button"
            className="pick-review"
            aria-pressed={reviewing}
            data-testid="picker-review-picked"
            onClick={() => setReviewing(!reviewing)}
          >
            {`Picked (${picked.length})`}
          </button>
        )}
        <p className="pick-status" role="status" data-testid="picker-status">
          <span className={pending ? "ld-sheen" : "pick-status-text"}>
            {statusLine({
              searching,
              reviewing,
              pickCount: picked.length,
              pending,
              shown: rows.length,
              total: total ?? null,
            })}
          </span>
        </p>
      </div>
      <div className="pick-body">
        {!reviewing && feed.isPending && rows.length === 0 ? (
          <SkeletonCards />
        ) : !reviewing && feed.isError && rows.length === 0 ? (
          <p role="alert" className="pick-state" data-testid="picker-error">
            Couldn’t reach your library. Check your connection and try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="pick-state" data-testid="picker-empty">
            {emptyMessage({ reviewing, searching, query })}
          </p>
        ) : (
          <div className="pick-grid">
            {rows.map((book) => (
              <PickCard
                key={book.uuid}
                book={book}
                picked={chosen.has(book.uuid)}
                onShelf={already.has(book.uuid)}
                onToggle={() => onPicked(toggled(picked, book))}
              />
            ))}
          </div>
        )}
        {hasMore && (
          <div className="pick-more-row" ref={loadMore}>
            <Button
              className="pick-more"
              data-testid="picker-load-more"
              disabled={browse.isFetchingNextPage}
              aria-busy={browse.isFetchingNextPage}
              onClick={() => browse.fetchNextPage()}
            >
              <BusyLabel
                busy={browse.isFetchingNextPage}
                label="Load more"
                busyLabel="Loading…"
              />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

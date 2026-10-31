import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  ApiError,
  type UserId,
  type WishlistBook,
  wishlistBooksQuery,
  wishlistReadersQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { HeartGlyph } from "../../components/Glyphs/Glyphs";
import {
  RowSkeletons,
  Skeleton,
  Stale,
} from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { ToastProvider } from "../../components/Toast/Toast";
import { nowSecs } from "../../format";
import { useCurrentUser } from "../../session";
import { AddToWishlist } from "./AddToWishlist";
import { ReaderPanel, ReaderPicker } from "./ReaderPanel";
import { WishlistRow } from "./WishlistRow";
import {
  heading,
  readerOf,
  type Scope,
  scopeFrom,
  subline,
  wishlistUser,
} from "./wishlistView";
import "./Wishlists.css";

type EmptyCopy = { title: string; body: string; offer: boolean };

function emptyCopy(scope: Scope, readerName: string): EmptyCopy {
  switch (scope.kind) {
    case "you":
      return {
        title: "Nothing on your wishlist yet",
        body: "Search by title, author or ISBN, or add it from any book’s page. Everyone in the household can see your wishlist.",
        offer: true,
      };
    case "everyone":
      return {
        title: "No one has anything on their wishlist yet",
        body: "When someone in the household adds a book to their wishlist, it shows up here, so you can find or request it for them. Start with yours.",
        offer: true,
      };
    case "reader":
      return {
        title: `Nothing on ${readerName}’s wishlist yet`,
        body: `When ${readerName} adds a book to their wishlist, it shows up here.`,
        offer: false,
      };
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

function Empty({
  scope,
  readerName,
  onAdd,
}: {
  scope: Scope;
  readerName: string;
  onAdd: () => void;
}) {
  const { title, body, offer } = emptyCopy(scope, readerName);
  return (
    <div className="wl-empty" data-testid="wishlists-empty">
      <span className="wl-empty-heart" aria-hidden="true">
        <HeartGlyph size={28} />
      </span>
      <h2 className="wl-empty-title">{title}</h2>
      <p className="wl-empty-body">{body}</p>
      {offer && (
        <Button variant="primary" onClick={onAdd}>
          Add to your wishlist
        </Button>
      )}
    </div>
  );
}

function List({
  books,
  scope,
  viewer,
}: {
  books: readonly WishlistBook[];
  scope: Scope;
  viewer: UserId;
}) {
  const now = nowSecs();
  return (
    <>
      <div className="wl-cols" aria-hidden="true">
        <span>Book</span>
        <span>In the library</span>
        <span>{scope.kind === "everyone" ? "Wanted by" : "Added"}</span>
      </div>
      <ul className="wl-list">
        {books.map((book) => (
          <WishlistRow
            key={book.uuid}
            book={book}
            scope={scope}
            viewer={viewer}
            now={now}
          />
        ))}
      </ul>
    </>
  );
}

/** A list that could not be read. A reader who isn't on the server returns to your own list; any other failure can be tried again. */
function Failure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <PageError
        message="That reader isn't on this server"
        backTo="/wishlists"
        backLabel="Back to your wishlist"
      />
    );
  }
  return (
    <>
      <p role="alert" className="subtitle">
        {error.message}
      </p>
      <Button onClick={onRetry}>Try again</Button>
    </>
  );
}

/** The scope the rows on screen were read for: it moves on only once the next list has landed, so a row never offers what another reader's list may not. */
function useSettledScope(scope: Scope, settled: boolean) {
  const [shown, setShown] = useState(scope);
  const same = shown.kind === scope.kind && readerId(shown) === readerId(scope);
  if (settled && !same) setShown(scope);
  return shown;
}

const readerId = (scope: Scope) => (scope.kind === "reader" ? scope.id : null);

/** `/wishlists`: the household's wishlists, one reader's or everyone's, picked by `?user=`. */
export function Wishlists() {
  const viewer = useCurrentUser();
  const scope = scopeFrom(useSearchParams()[0].get("user"), viewer.id);
  const [adding, setAdding] = useState(false);
  const readers = useQuery(wishlistReadersQuery);
  const books = useQuery(wishlistBooksQuery(wishlistUser(scope)));
  // The title of a reader's list needs their name; the others need nothing.
  const titled = scope.kind !== "reader" || readers.data !== undefined;
  const title = heading(scope, readers.data?.readers ?? []);
  const readerName = readerOf(scope, readers.data?.readers ?? [])?.name ?? "";
  const refreshing = books.isPlaceholderData;
  const rowsScope = useSettledScope(scope, !refreshing);
  const answered = books.data !== undefined && titled;
  // A reader's list can't be titled without the readers, so their failure stops the page too.
  const failure = books.isError
    ? { error: books.error, retry: () => books.refetch() }
    : scope.kind === "reader" && readers.isError
      ? { error: readers.error, retry: () => readers.refetch() }
      : null;
  const wishlists =
    readers.data?.readers.filter((r) => r.count > 0).length ?? null;
  return (
    <ToastProvider>
      <PageTitle page="Wishlists" />
      <div className="wl-page" data-testid="wishlists-page">
        <ReaderPanel
          data={readers.data}
          failed={readers.isError}
          scope={scope}
        />
        <section className="wl-body">
          {failure ? (
            <Failure error={failure.error} onRetry={failure.retry} />
          ) : (
            <>
              <header className="wl-head">
                <div className="wl-head-text">
                  {answered ? (
                    <ReaderPicker data={readers.data} scope={scope}>
                      <h1
                        className="wl-title-text"
                        data-testid="wishlists-heading"
                      >
                        {title}
                      </h1>
                    </ReaderPicker>
                  ) : (
                    <Skeleton
                      shape="block"
                      style={{ "--w": "min(360px, 80%)", "--h": "44px" }}
                    />
                  )}
                  {answered && !refreshing ? (
                    <p className="wl-subline">
                      {books.data.length > 0 &&
                        subline(scope, books.data.length, wishlists)}
                    </p>
                  ) : (
                    <p className="wl-subline">
                      <Skeleton style={{ "--w": "120px" }} />
                    </p>
                  )}
                </div>
                {answered && (
                  <AddToWishlist open={adding} onOpenChange={setAdding} />
                )}
              </header>
              {answered ? (
                <Stale stale={refreshing}>
                  {books.data.length === 0 && !refreshing ? (
                    <Empty
                      scope={scope}
                      readerName={readerName}
                      onAdd={() => setAdding(true)}
                    />
                  ) : (
                    <List
                      books={books.data}
                      scope={rowsScope}
                      viewer={viewer.id}
                    />
                  )}
                </Stale>
              ) : (
                <>
                  <span className="ld-sr" role="status">
                    Gathering the wishlists
                  </span>
                  <RowSkeletons count={5} avatar={false} />
                </>
              )}
            </>
          )}
        </section>
      </div>
    </ToastProvider>
  );
}

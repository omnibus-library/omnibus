import { useQuery } from "@tanstack/react-query";
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
import { ReaderPanel, ReaderPicker } from "./ReaderPanel";
import { WishlistRow } from "./WishlistRow";
import {
  heading,
  type Scope,
  scopeFrom,
  subline,
  wishlistUser,
} from "./wishlists";
import "./Wishlists.css";

type EmptyCopy = { title: string; body: string; offer: boolean };

function emptyCopy(scope: Scope, readerName: string): EmptyCopy {
  switch (scope.kind) {
    case "you":
      return {
        title: "Nothing on your wishlist yet",
        body: "Search for a book by title, author or ISBN, or tap the heart on any book’s page. Everyone in the household can see what you’re hoping for.",
        offer: true,
      };
    case "everyone":
      return {
        title: "No one has anything on their wishlist yet",
        body: "When someone in the household hopes for a book, it lands here, so you can see what to find or request for them. Start with yours.",
        offer: true,
      };
    case "reader":
      return {
        title: `Nothing on ${readerName}’s wishlist yet`,
        body: `When ${readerName} hopes for a book, it lands here.`,
        offer: false,
      };
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

function Empty({ scope, readerName }: { scope: Scope; readerName: string }) {
  const { title, body, offer } = emptyCopy(scope, readerName);
  return (
    <div className="wl-empty" data-testid="wishlists-empty">
      <span className="wl-empty-heart" aria-hidden="true">
        <HeartGlyph size={28} />
      </span>
      <h2 className="wl-empty-title">{title}</h2>
      <p className="wl-empty-body">{body}</p>
      {offer && <Button variant="primary">Add to your wishlist</Button>}
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

/** A list that could not be read; either way the way back is your own list. */
function Failure({ error }: { error: Error }) {
  const unknownReader = error instanceof ApiError && error.status === 404;
  return (
    <PageError
      message={
        unknownReader ? "That reader isn't on this server" : error.message
      }
      backTo="/wishlists"
      backLabel="Back to your wishlist"
    />
  );
}

/** `/wishlists`: the household's wishlists, one reader's or everyone's, picked by `?user=`. */
export function Wishlists() {
  const viewer = useCurrentUser();
  const scope = scopeFrom(useSearchParams()[0].get("user"), viewer.id);
  const readers = useQuery(wishlistReadersQuery);
  const books = useQuery(wishlistBooksQuery(wishlistUser(scope)));
  // The title of a reader's list needs their name; the others need nothing.
  const titled = scope.kind !== "reader" || readers.data !== undefined;
  const title = heading(scope, readers.data?.readers ?? []);
  const readerName =
    readers.data?.readers.find(
      (r) => scope.kind === "reader" && r.id === scope.id,
    )?.name ?? "";
  const answered = books.data !== undefined && titled;
  const refreshing = books.isPlaceholderData;
  const wishlists =
    readers.data?.readers.filter((r) => r.count > 0).length ?? null;
  return (
    <ToastProvider>
      <PageTitle page="Wishlists" />
      <div className="wl-page" data-testid="wishlists-page">
        <ReaderPanel data={readers.data} scope={scope} />
        <section className="wl-body">
          {books.isError ? (
            <Failure error={books.error} />
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
                      {subline(scope, books.data.length, wishlists)}
                    </p>
                  ) : (
                    <p className="wl-subline">
                      <Skeleton style={{ "--w": "120px" }} />
                    </p>
                  )}
                </div>
              </header>
              {answered ? (
                <Stale stale={refreshing}>
                  {books.data.length === 0 && !refreshing ? (
                    <Empty scope={scope} readerName={readerName} />
                  ) : (
                    <List books={books.data} scope={scope} viewer={viewer.id} />
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

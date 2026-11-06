import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";
import {
  addToWishlist,
  removeFromWishlist,
  thumbUrl,
  type UserId,
  type WishlistBook,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { ChevronDownGlyph } from "../../components/Glyphs/Glyphs";
import { BusyLabel } from "../../components/Loading/Loading";
import { MoreMenu } from "../../components/MoreMenu/MoreMenu";
import { Sheet } from "../../components/Sheet/Sheet";
import { useToast } from "../../components/Toast/Toast";
import { findCopyUrl } from "../../findCopy";
import { useCurrentUser } from "../../session";
import { FROM_WISHLISTS } from "../BookRequest/requestView";
import { useStartRequest } from "../BookRequest/useStartRequest";
import { refreshAfterWrite } from "./refresh";
import {
  addedLabel,
  byline,
  holdingLabel,
  type RequestKind,
  requestable,
  type Scope,
  wantedByNames,
} from "./wishlistView";

const REQUEST_LABEL = {
  ebook: "Request ebook",
  audiobook: "Request audiobook",
} satisfies Record<RequestKind, string>;

function Holdings({ holdings }: Pick<WishlistBook, "holdings">) {
  if (holdings.length === 0) {
    return (
      <span className="wl-none">
        <span aria-hidden="true" className="wl-none-dash">
          —
        </span>
        <span className="sr-only wl-none-text">Not in the library</span>
      </span>
    );
  }
  return (
    <ul className="wl-holdings" aria-label="In the library">
      {holdings.map((holding) => {
        const { name, times } = holdingLabel(holding);
        return (
          <li key={holding.format} className="wl-holding">
            <span className="wl-badge">{name}</span>
            {times && <span className="wl-times">{times}</span>}
          </li>
        );
      })}
    </ul>
  );
}

type StartRequest = ReturnType<typeof useStartRequest>;

/** Takes the book off your list and offers Undo, unless the book went with its last entry. */
function useRemove(book: WishlistBook) {
  const client = useQueryClient();
  const toast = useToast();
  const undo = async () => {
    try {
      await addToWishlist(book.uuid);
      await refreshAfterWrite(client, book.uuid);
    } catch (error) {
      toast(`Couldn’t put ${book.title} back: ${messageOf(error)}`);
    }
  };
  return useMutation({
    mutationFn: () => removeFromWishlist(book.uuid),
    onSuccess: ({ bookDeleted }) => {
      const message = `Removed ${book.title} from your wishlist`;
      toast(
        message,
        bookDeleted ? undefined : { label: "Undo", onClick: undo },
      );
      return refreshAfterWrite(client, book.uuid, bookDeleted);
    },
    onError: (error) =>
      toast(`Couldn’t remove ${book.title}: ${messageOf(error)}`),
  });
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const AUDIOBOOK_REASON = "Audiobook requests aren’t available yet";

/** Request ▾ with nothing to ask for yet: it stays focusable, says why, and does nothing. */
function RequestUnavailable() {
  const reason = useId();
  // Without a pointer to hover with, a tap is what shows why it can't be used.
  const [tapped, setTapped] = useState(false);
  return (
    <span className="wl-request-wrap">
      <button
        type="button"
        className="btn sm wl-act wl-request"
        data-testid="wishlists-request"
        aria-disabled="true"
        aria-describedby={reason}
        onClick={() => setTapped(!tapped)}
        onBlur={() => setTapped(false)}
      >
        Request
        <ChevronDownGlyph size={10} />
      </button>
      <span
        role="tooltip"
        id={reason}
        className={tapped ? "wl-tip is-shown" : "wl-tip"}
      >
        {AUDIOBOOK_REASON}
      </span>
    </span>
  );
}

/** Request ▾: what can be asked for. An ebook starts a request and opens it; an audiobook can't be asked for yet. */
function RequestMenu({
  book,
  kinds,
  start,
}: {
  book: WishlistBook;
  kinds: RequestKind[];
  start: StartRequest;
}) {
  const [open, setOpen] = useState(false);
  if (!kinds.includes("ebook")) return <RequestUnavailable />;
  return (
    <span className="wl-request-wrap">
      <button
        type="button"
        className="btn sm wl-act wl-request"
        data-testid="wishlists-request"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={start.isPending}
        aria-busy={start.isPending}
        onClick={() => {
          if (!start.isPending) setOpen(!open);
        }}
      >
        <BusyLabel
          busy={start.isPending}
          label="Request"
          busyLabel="Requesting…"
        />
        <ChevronDownGlyph size={10} />
      </button>
      {open && (
        <MoreMenu
          label={`Request ${book.title}`}
          onClose={() => setOpen(false)}
          items={kinds.map((kind) => ({
            label: REQUEST_LABEL[kind],
            testId: `wishlists-request-${kind}`,
            disabled: kind === "audiobook",
            note: kind === "audiobook" ? "Not available yet" : undefined,
            onSelect: () => start.mutate(),
          }))}
        />
      )}
    </span>
  );
}

/** The hover actions on a wide screen: always laid out, so the columns never shift. */
function RowActions({
  book,
  kinds,
  start,
  remove,
}: {
  book: WishlistBook;
  kinds: RequestKind[];
  start: StartRequest;
  remove: ReturnType<typeof useRemove> | null;
}) {
  return (
    <div className="wl-actions">
      <a
        className="btn sm wl-act"
        data-testid="wishlists-find-copy"
        href={findCopyUrl(book)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Find a Copy
      </a>
      {kinds.length > 0 && (
        <RequestMenu book={book} kinds={kinds} start={start} />
      )}
      {remove && (
        <Button
          variant="ghost"
          size="sm"
          className="wl-act"
          data-testid="wishlists-remove"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Remove
        </Button>
      )}
    </div>
  );
}

type SheetState = "closed" | "open" | "closing";

/** The phone's Get menu for one book: where to find it, what can be requested, and, on your own list, Remove. */
function GetSheet({
  book,
  kinds,
  start,
  remove,
  detail,
  line,
  onDismiss,
  closing,
  onClosed,
}: {
  book: WishlistBook;
  kinds: RequestKind[];
  start: StartRequest;
  remove: ReturnType<typeof useRemove> | null;
  detail: string;
  line: string;
  closing: boolean;
  onDismiss: () => void;
  onClosed: () => void;
}) {
  return (
    <Sheet
      label={`Get ${book.title}`}
      testId="wishlists-get-sheet"
      compact
      closing={closing}
      onDismiss={onDismiss}
      onClosed={onClosed}
    >
      <div className="wl-sheet">
        <header className="wl-sheet-head">
          <div className="wl-sheet-cover">
            <Cover
              book={book}
              src={book.hasCover ? thumbUrl(book.uuid) : null}
            />
          </div>
          <div className="wl-sheet-text">
            <h2 className="wl-sheet-title">{book.title}</h2>
            <p className="wl-sheet-line">{line}</p>
          </div>
        </header>
        <ul className="wl-sheet-items">
          <li>
            <a
              className="wl-sheet-item"
              href={findCopyUrl(book)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onDismiss}
            >
              <span>Find a copy</span>
              <span className="wl-sheet-sub">
                Opens an Amazon search for this book
              </span>
            </a>
          </li>
          {kinds.map((kind) => (
            <li key={kind}>
              <button
                type="button"
                className="wl-sheet-item"
                disabled={kind === "audiobook" || start.isPending}
                onClick={() => {
                  start.mutate();
                  onDismiss();
                }}
              >
                <span>{REQUEST_LABEL[kind]}</span>
                <span className="wl-sheet-sub">
                  {kind === "audiobook"
                    ? "Not available yet"
                    : "Start looking for a version"}
                </span>
              </button>
            </li>
          ))}
          <li>
            <Link className="wl-sheet-item" to={detail}>
              <span>Open book page</span>
            </Link>
          </li>
          {remove && (
            <li>
              <button
                type="button"
                className="wl-sheet-item wl-sheet-remove"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate();
                  onDismiss();
                }}
              >
                <span>Remove from wishlist</span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </Sheet>
  );
}

/** One wishlisted book: its cover and title, what the library holds of it, who added it or when, and what can be done about it. */
export function WishlistRow({
  book,
  scope,
  viewer,
  now,
}: {
  book: WishlistBook;
  scope: Scope;
  viewer: UserId;
  now: number;
}) {
  const [sheet, setSheet] = useState<SheetState>("closed");
  const detail = `/books/${book.uuid}`;
  const wanted = scope.kind === "everyone";
  const user = useCurrentUser();
  const kinds = user.canRequest ? requestable(book.holdings) : [];
  const start = useStartRequest(book.uuid, { from: FROM_WISHLISTS });
  const removeBook = useRemove(book);
  // Only your own list can be edited.
  const remove = scope.kind === "you" ? removeBook : null;
  const names = wantedByNames(book.wantedBy, viewer);
  const added = addedLabel(book.addedAt, now);
  return (
    <li className="wl-row" data-testid="wishlists-row" data-uuid={book.uuid}>
      {/* The title link is the one a keyboard or screen reader meets. */}
      <Link to={detail} className="wl-cover" tabIndex={-1} aria-hidden="true">
        <Cover book={book} src={book.hasCover ? thumbUrl(book.uuid) : null} />
      </Link>
      <div className="wl-book">
        <Link to={detail} className="wl-title" data-testid="wishlists-title">
          {book.title}
        </Link>
        <p className="wl-byline">{byline(book)}</p>
      </div>
      <div className="wl-library">
        <Holdings holdings={book.holdings} />
      </div>
      <p className={wanted ? "wl-meta wl-wanted" : "wl-meta wl-added"}>
        <span className="sr-only wl-prefix">
          {wanted ? "Wanted by " : "Added "}
        </span>
        {wanted ? names : added}
      </p>
      <RowActions book={book} kinds={kinds} start={start} remove={remove} />
      <button
        type="button"
        className="btn sm wl-get"
        data-testid="wishlists-get"
        aria-haspopup="dialog"
        onClick={() => setSheet("open")}
      >
        Get
        <ChevronDownGlyph size={10} />
      </button>
      {sheet !== "closed" && (
        <GetSheet
          book={book}
          kinds={kinds}
          start={start}
          remove={remove}
          detail={detail}
          line={`${byline({ authors: book.authors, series: null })} · ${
            wanted ? `wanted by ${names}` : `added ${added}`
          }`}
          closing={sheet === "closing"}
          onDismiss={() => setSheet("closing")}
          onClosed={() => setSheet("closed")}
        />
      )}
    </li>
  );
}

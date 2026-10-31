import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  type BookUuid,
  type ExternalBookMeta,
  fetchWishlist,
  parseBookUuid,
  removeFromWishlist,
  resolveBook,
  resolveMeta,
  type ScanBook,
  searchLibraryBooks,
  searchProviders,
  thumbUrl,
  wishlistScanned,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { PlusGlyph, SearchGlyph, XGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { Sheet } from "../../components/Sheet/Sheet";
import { useToast } from "../../components/Toast/Toast";
import { useDebounced } from "../../useDebounced";
import { useMediaQuery } from "../../useMediaQuery";
import {
  cleanIsbn,
  type FoundVia,
  isbnRejection,
  wishlistSource,
} from "../CheckIn/checkInFlow";
import { refreshAfterWrite } from "./refresh";
import { existingBook, isbnResults, onlineHeading } from "./wishlistView";

/** The widths where the panel is a bottom sheet; `Sheet.css` turns its own dialog into one at the same line. */
const PHONE = "(max-width: 720px)";

/** A search hit the reader may add: a library book, or a provider's record of one. A lookup by ISBN has already said which library book a record matches, so that record carries the answer (`null` for none). */
type Hit =
  | { kind: "library"; book: ScanBook }
  | { kind: "online"; meta: ExternalBookMeta; matched?: ScanBook | null };

const titleOf = (hit: Hit) =>
  hit.kind === "library" ? hit.book.title : hit.meta.title;

/** The write for a hit: a provider's record that matches a library book goes against that book, and only one that matches none is made into a new one. */
async function requestFor(hit: Hit, via: FoundVia) {
  const source = wishlistSource[via];
  if (hit.kind === "library") return { book_uuid: hit.book.uuid, source };
  const found =
    hit.matched === undefined
      ? existingBook(await resolveMeta(hit.meta))
      : hit.matched;
  return found ? { book_uuid: found.uuid, source } : { meta: hit.meta, source };
}

/** Adds to your own list, and says whether the book was already on it: Undo must never remove an entry that was there before. */
async function addHit(hit: Hit, via: FoundVia) {
  const request = await requestFor(hit, via);
  const target =
    "book_uuid" in request ? parseBookUuid(request.book_uuid) : null;
  // A record made into a new book cannot have been listed, and a read that fails stops the add.
  const alreadyListed = target ? (await fetchWishlist(target)) !== null : false;
  const uuid = await wishlistScanned(request);
  return { uuid: parseBookUuid(uuid), alreadyListed };
}

const libraryNote = (book: ScanBook) =>
  book.has_files
    ? "in the library"
    : book.has_physical
      ? "print copy in the library"
      : "on a wishlist";

function Result({
  hit,
  disabled,
  onAdd,
}: {
  hit: Hit;
  disabled: boolean;
  onAdd: () => void;
}) {
  const title = titleOf(hit);
  const library = hit.kind === "library";
  const authors = library ? hit.book.authors : hit.meta.authors;
  const libraryUuid = library ? parseBookUuid(hit.book.uuid) : null;
  const cover = library
    ? libraryUuid && hit.book.cover_url
      ? thumbUrl(libraryUuid)
      : null
    : (hit.meta.cover_url ?? null);
  const detail = library
    ? libraryNote(hit.book)
    : [hit.meta.publisher, hit.meta.year].filter(Boolean).join(" · ");
  return (
    <li className="wl-add-result" data-testid="wishlists-add-result">
      <div className="wl-add-cover">
        <Cover book={{ title, authors, accent: null }} src={cover} />
      </div>
      <div className="wl-add-text">
        <p className="wl-add-title">{title}</p>
        <p className="wl-add-byline">
          {[authors.join(", "), detail].filter(Boolean).join(" · ")}
        </p>
      </div>
      <Button
        size="sm"
        className="wl-add-go"
        disabled={disabled}
        aria-label={`Add ${title}`}
        onClick={onAdd}
      >
        Add
      </Button>
    </li>
  );
}

type SectionProps = {
  heading: string;
  testId: string;
  state: "loading" | "error" | "done";
  hits: Hit[];
  disabled: boolean;
  onAdd: (hit: Hit) => void;
};

function Section({
  heading,
  testId,
  state,
  hits,
  disabled,
  onAdd,
}: SectionProps) {
  return (
    <section className="wl-add-section" data-testid={testId}>
      <h3 className="wl-add-heading">{heading}</h3>
      {state === "loading" && <Loading kind="row" label="Searching…" />}
      {state === "error" && (
        <p className="wl-add-none">Couldn’t search just now.</p>
      )}
      {state === "done" && hits.length === 0 && (
        <p className="wl-add-none">Nothing matches</p>
      )}
      {state === "done" && hits.length > 0 && (
        <ul className="wl-add-results">
          {hits.map((hit, i) => (
            <Result
              // Providers can return one ISBN twice, and the list is only ever replaced whole.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={
                hit.kind === "library"
                  ? hit.book.uuid
                  : `${hit.meta.source}-${hit.meta.isbn13}-${i}`
              }
              hit={hit}
              disabled={disabled}
              onAdd={() => onAdd(hit)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const stateOf = (q: {
  isPending: boolean;
  isError: boolean;
}): SectionProps["state"] =>
  q.isPending ? "loading" : q.isError ? "error" : "done";

/** What a search finds: the library's books, then the providers'. An ISBN asks the lookup once; anything else asks the library and the providers separately, so the library answers first. */
function useAddSearch(text: string) {
  const query = text.trim();
  const isbn = cleanIsbn(query);
  const isIsbn = query !== "" && isbnRejection(isbn) === null;
  const searching = query !== "";
  const lookup = useQuery({
    queryKey: ["wishlist-search", "isbn", isbn],
    queryFn: () => resolveBook(isbn),
    enabled: isIsbn,
  });
  const library = useQuery({
    queryKey: ["wishlist-search", "library", query],
    queryFn: () => searchLibraryBooks(query),
    enabled: searching && !isIsbn,
  });
  const online = useQuery({
    queryKey: ["wishlist-search", "online", query],
    queryFn: () => searchProviders(query),
    enabled: searching && !isIsbn,
  });
  if (!searching) return null;
  const found = lookup.data ? isbnResults(lookup.data) : null;
  const libraryBooks = isIsbn ? found?.library : library.data?.books;
  const onlineBooks = isIsbn ? found?.online : online.data;
  const libraryHits: Hit[] = (libraryBooks ?? []).map((book) => ({
    kind: "library",
    book,
  }));
  // The lookup's own answer for a record it found, so an ISBN search needs no second one.
  const matched = isIsbn && lookup.data ? existingBook(lookup.data) : undefined;
  const onlineHits: Hit[] = (onlineBooks ?? []).map((meta) => ({
    kind: "online",
    meta,
    matched,
  }));
  const via: FoundVia = isIsbn ? "isbn" : "search";
  return {
    via,
    library: { state: stateOf(isIsbn ? lookup : library), hits: libraryHits },
    online: {
      state: stateOf(isIsbn ? lookup : online),
      hits: onlineHits,
      heading: onlineHeading(onlineBooks ?? []),
    },
  };
}

type Add = UseMutationResult<
  { uuid: BookUuid | null; alreadyListed: boolean },
  Error,
  { hit: Hit; via: FoundVia }
>;

/** The search box and what it finds. */
function AddPanel({
  add,
  error,
  sheet,
  onClose,
}: {
  add: Add;
  error: string | null;
  /** In a bottom sheet, which brings its own title and Close. */
  sheet: boolean;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const found = useAddSearch(useDebounced(text));
  // A phone's keyboard would cover the sheet the moment it opened.
  useEffect(() => (sheet ? undefined : input.current?.focus()), [sheet]);
  const onAdd = (hit: Hit) => {
    if (found) add.mutate({ hit, via: found.via });
  };
  return (
    <>
      {sheet && (
        <header className="wl-add-head">
          <h2 className="wl-add-head-title">Add to your wishlist</h2>
          <button
            type="button"
            className="wl-add-close"
            aria-label="Close"
            onClick={onClose}
          >
            <XGlyph size={16} />
          </button>
        </header>
      )}
      <label className="wl-add-field">
        <SearchGlyph size={16} />
        <input
          ref={input}
          type="search"
          className="wl-add-search"
          data-testid="wishlists-add-search"
          aria-label="Title, author or ISBN"
          aria-describedby="wishlists-add-hint"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p id="wishlists-add-hint" className="wl-add-hint">
        Title, author or ISBN. Adds to your wishlist.
      </p>
      {error && (
        <p
          role="alert"
          className="wl-add-error"
          data-testid="wishlists-add-error"
        >
          {error}
        </p>
      )}
      {found && (
        <>
          <Section
            heading="In your library"
            testId="wishlists-add-library"
            state={found.library.state}
            hits={found.library.hits}
            disabled={add.isPending}
            onAdd={onAdd}
          />
          <Section
            heading={found.online.heading}
            testId="wishlists-add-online"
            state={found.online.state}
            hits={found.online.hits}
            disabled={add.isPending}
            onAdd={onAdd}
          />
        </>
      )}
    </>
  );
}

/** The Add to wishlist button and the panel it opens: a popover under it on a wide screen, a bottom sheet on a phone. */
export function AddToWishlist({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const button = useRef<HTMLButtonElement>(null);
  const phone = useMediaQuery(PHONE);
  // The sheet leaves with an exit animation before the owner is told.
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undo = (uuid: BookUuid, title: string) => async () => {
    try {
      await removeFromWishlist(uuid);
      await refreshAfterWrite(client, uuid);
    } catch (e) {
      toast(
        `Couldn’t take ${title} off: ${e instanceof Error ? e.message : "try again."}`,
      );
    }
  };
  const leave = () => {
    setClosing(false);
    setError(null);
    onOpenChange(false);
    button.current?.focus();
  };
  const add = useMutation({
    mutationFn: ({ hit, via }: { hit: Hit; via: FoundVia }) => addHit(hit, via),
    onMutate: () => setError(null),
    onSuccess: ({ uuid, alreadyListed }, { hit }) => {
      const title = titleOf(hit);
      // Undo would delete an entry that was there before this add.
      if (alreadyListed) {
        toast(`${title} is already on your wishlist`);
      } else {
        toast(
          `Added ${title} to your wishlist`,
          uuid ? { label: "Undo", onClick: undo(uuid, title) } : undefined,
        );
      }
      leave();
      return uuid ? refreshAfterWrite(client, uuid) : undefined;
    },
    onError: (e, { hit }) =>
      setError(`Couldn’t add ${titleOf(hit)}: ${e.message}`),
  });
  // Nothing closes the panel while an add is in flight, so its answer lands on the panel that asked.
  const close = () => {
    if (add.isPending) return;
    if (phone) setClosing(true);
    else leave();
  };
  const dismiss = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  const panel = (
    <AddPanel add={add} error={error} sheet={phone} onClose={close} />
  );
  return (
    <div className="wl-add">
      <button
        ref={button}
        type="button"
        className="btn wl-add-button"
        data-testid="wishlists-add"
        aria-label="Add to wishlist"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <PlusGlyph size={14} />
        <span className="wl-add-button-text">Add to wishlist</span>
      </button>
      {open && phone && (
        <Sheet
          label="Add to your wishlist"
          testId="wishlists-add-panel"
          compact
          busy={add.isPending}
          closing={closing}
          onDismiss={close}
          onClosed={leave}
        >
          <div className="wl-add-sheet">{panel}</div>
        </Sheet>
      )}
      {open && !phone && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a pointer-only backdrop that catches an outside click; Escape already closes the panel */}
          <div
            className="wl-add-scrim"
            data-testid="wishlists-add-scrim"
            onClick={close}
          />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape bubbles up from the field or a button, which hold the focus */}
          <div
            className="wl-add-panel"
            data-testid="wishlists-add-panel"
            role="dialog"
            aria-label="Add to your wishlist"
            onKeyDown={dismiss}
          >
            {panel}
          </div>
        </>
      )}
    </div>
  );
}

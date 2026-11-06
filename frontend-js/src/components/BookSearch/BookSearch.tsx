import { useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type ExternalBookMeta,
  type FoundBook,
  parseBookUuid,
  resolveBook,
  type ScanBook,
  searchLibraryBooks,
  searchProviders,
  thumbUrl,
} from "../../api";
import {
  cleanIsbn,
  type FoundVia,
  isbnRejection,
} from "../../pages/CheckIn/checkInFlow";
import {
  existingBook,
  isbnResults,
  onlineHeading,
} from "../../pages/Wishlists/wishlistView";
import { useDebounced } from "../../useDebounced";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { BarcodeScanner } from "../BarcodeScanner/BarcodeScanner";
import { Button } from "../Button/Button";
import { Cover } from "../Cover/Cover";
import { PlusGlyph, ScanGlyph, SearchGlyph, XGlyph } from "../Glyphs/Glyphs";
import { Loading } from "../Loading/Loading";
import { Sheet } from "../Sheet/Sheet";
import "./BookSearch.css";

/** A search hit the reader may act on: a library book, or a provider's record of one. A lookup by ISBN has already said which library book a record matches, so that record carries the answer (`null` for none). */
export type Hit =
  | { kind: "library"; book: FoundBook }
  | { kind: "online"; meta: ExternalBookMeta; matched?: ScanBook | null };

export const titleOf = (hit: Hit) =>
  hit.kind === "library" ? hit.book.title : hit.meta.title;

/** What one result says and offers; no `action`, no button. `note` replaces the line after its authors. */
export type Offer = {
  note?: string;
  action: { label: string; name: string; run: (via: FoundVia) => void } | null;
};

function Result({
  hit,
  offer,
  via,
  testId,
  disabled,
}: {
  hit: Hit;
  offer: Offer;
  via: FoundVia;
  testId: string;
  disabled: boolean;
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
  const detail =
    offer.note ??
    (library
      ? ""
      : [hit.meta.publisher, hit.meta.year].filter(Boolean).join(" · "));
  const { action } = offer;
  return (
    <li className="bsearch-result" data-testid={`${testId}-result`}>
      <div className="bsearch-cover">
        <Cover book={{ title, authors, accent: null }} src={cover} />
      </div>
      <div className="bsearch-text">
        <p className="bsearch-title">{title}</p>
        <p className="bsearch-byline">
          {[authors.join(", "), detail].filter(Boolean).join(" · ")}
        </p>
      </div>
      {action && (
        <Button
          size="sm"
          className="bsearch-go"
          disabled={disabled}
          aria-label={action.name}
          onClick={() => action.run(via)}
        >
          {action.label}
        </Button>
      )}
    </li>
  );
}

type SectionProps = {
  heading: string;
  testId: string;
  state: "loading" | "error" | "done";
  hits: Hit[];
  via: FoundVia;
  resultTestId: string;
  disabled: boolean;
  offer: (hit: Hit) => Offer;
};

function Section({
  heading,
  testId,
  state,
  hits,
  via,
  resultTestId,
  disabled,
  offer,
}: SectionProps) {
  return (
    <section className="bsearch-section" data-testid={testId}>
      <h3 className="bsearch-heading">{heading}</h3>
      {state === "loading" && <Loading kind="row" label="Searching…" />}
      {state === "error" && (
        <p className="bsearch-none">Couldn’t search just now.</p>
      )}
      {state === "done" && hits.length === 0 && (
        <p className="bsearch-none">Nothing matches</p>
      )}
      {state === "done" && hits.length > 0 && (
        <ul className="bsearch-results">
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
              offer={offer(hit)}
              via={via}
              testId={resultTestId}
              disabled={disabled}
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
function useBookSearch(text: string) {
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

type Copy = {
  /** The button's text. */
  button: string;
  /** The button's accessible name. */
  name: string;
  /** The sheet's title, and the popover's label. */
  title: string;
  hint: string;
};

type PanelProps = {
  testId: string;
  copy: Copy;
  busy: boolean;
  error: string | null;
  offer: (hit: Hit) => Offer;
  scan: boolean;
  /** In a bottom sheet, which brings its own title and Close. */
  sheet: boolean;
  asks: number;
  onClose: () => void;
};

/** The search box and what it finds. */
function Panel({
  testId,
  copy,
  busy,
  error,
  offer,
  scan,
  sheet,
  asks,
  onClose,
}: PanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [scanning, setScanning] = useState(false);
  const found = useBookSearch(useDebounced(text));
  const hint = `${testId}-hint`;
  // A phone's keyboard would cover the sheet the moment it opened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new ask is the cue to focus again, on a panel already open
  useEffect(() => (sheet ? undefined : input.current?.focus()), [sheet, asks]);
  return (
    <>
      {sheet && (
        <header className="bsearch-head">
          <h2 className="bsearch-head-title">{copy.title}</h2>
          <button
            type="button"
            className="bsearch-close"
            aria-label="Close"
            onClick={onClose}
          >
            <XGlyph size={16} />
          </button>
        </header>
      )}
      <div className="bsearch-find">
        <label className="bsearch-field">
          <SearchGlyph size={16} />
          <input
            ref={input}
            type="search"
            className="bsearch-search"
            data-testid={`${testId}-search`}
            aria-label="Title, author or ISBN"
            aria-describedby={hint}
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {scan && sheet && (
          <button
            type="button"
            className="bsearch-scan"
            data-testid={`${testId}-scan`}
            aria-label="Scan a barcode"
            aria-pressed={scanning}
            onClick={() => setScanning(!scanning)}
          >
            <ScanGlyph size={18} />
          </button>
        )}
      </div>
      <p id={hint} className="bsearch-hint">
        {copy.hint}
      </p>
      {error && (
        <p
          role="alert"
          className="bsearch-error"
          data-testid={`${testId}-error`}
        >
          {error}
        </p>
      )}
      {scanning && (
        <BarcodeScanner
          onDetect={(isbn) => {
            setText(isbn);
            setScanning(false);
          }}
          onManual={() => setScanning(false)}
        />
      )}
      {found && !scanning && (
        <>
          <Section
            heading="In your library"
            testId={`${testId}-library`}
            state={found.library.state}
            hits={found.library.hits}
            via={found.via}
            resultTestId={testId}
            disabled={busy}
            offer={offer}
          />
          <Section
            heading={found.online.heading}
            testId={`${testId}-online`}
            state={found.online.state}
            hits={found.online.hits}
            via={found.via}
            resultTestId={testId}
            disabled={busy}
            offer={offer}
          />
        </>
      )}
    </>
  );
}

/** A button and the search it opens: a popover under it on a wide screen, a bottom sheet on a phone. What a result offers is the caller's. */
export function BookSearch({
  open,
  onOpenChange,
  asks = 0,
  testId,
  copy,
  busy,
  error,
  offer,
  scan = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Counts the top bar's Add menu asking for the search, which focuses its field each time. */
  asks?: number;
  /** The prefix of every `data-testid` and of the hint's id. */
  testId: string;
  copy: Copy;
  /** Disables every action, and nothing closes the panel while it holds, so an answer lands on the panel that asked. */
  busy: boolean;
  error: string | null;
  offer: (hit: Hit) => Offer;
  /** On a phone, a button beside the field that reads a barcode into it. */
  scan?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  // The sheet leaves with an exit animation before the owner is told.
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);
  // Before paint, so focus is back on the button the moment the panel is gone.
  useLayoutEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const leave = () => {
    setClosing(false);
    onOpenChange(false);
  };
  const close = () => {
    if (busy) return;
    if (phone) setClosing(true);
    else leave();
  };
  const dismiss = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  const panel = (
    <Panel
      testId={testId}
      copy={copy}
      busy={busy}
      error={error}
      offer={offer}
      scan={scan}
      sheet={phone}
      asks={asks}
      onClose={close}
    />
  );
  return (
    <div className="bsearch">
      <button
        ref={button}
        type="button"
        className="btn bsearch-button"
        data-testid={testId}
        aria-label={copy.name}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <PlusGlyph size={14} />
        <span className="bsearch-button-text">{copy.button}</span>
      </button>
      {open && phone && (
        <Sheet
          label={copy.title}
          testId={`${testId}-panel`}
          compact
          busy={busy}
          closing={closing}
          onDismiss={close}
          onClosed={leave}
        >
          <div className="bsearch-sheet">{panel}</div>
        </Sheet>
      )}
      {open && !phone && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a pointer-only backdrop that catches an outside click; Escape already closes the panel */}
          <div
            className="bsearch-scrim"
            data-testid={`${testId}-scrim`}
            onClick={close}
          />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape bubbles up from the field or a button, which hold the focus */}
          <div
            className="bsearch-panel"
            data-testid={`${testId}-panel`}
            role="dialog"
            aria-label={copy.title}
            onKeyDown={dismiss}
          >
            {panel}
          </div>
        </>
      )}
    </div>
  );
}

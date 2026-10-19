import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { plural } from "../../format";
import { paletteQuery, searchHref } from "../../search";
import { useCurrentUser } from "../../session";
import { matchingSettings } from "../../settingsIndex";
import { useDebounced } from "../../useDebounced";
import { SearchGlyph } from "../Glyphs/Glyphs";
import { Loading, Ring } from "../Loading/Loading";
import { ResultsList } from "./PaletteRows";
import {
  itemHref,
  itemKey,
  moveSelection,
  paletteGroups,
  selectedIndex,
} from "./selection";
import "./SearchPalette.css";

type PaletteState = { open: boolean; setOpen: (open: boolean) => void };

const PaletteContext = createContext<PaletteState | null>(null);

function usePalette(): PaletteState {
  const state = useContext(PaletteContext);
  if (!state) throw new Error("palette rendered outside SearchPaletteProvider");
  return state;
}

/** Whether the palette is open, for the trigger and overlay; ⌘K / Ctrl+K toggles it. */
export function SearchPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  // Taken before the input's autoFocus moves focus, so closing can hand it back.
  const opener = useRef<Element | null>(null);
  const setOpen = useCallback((next: boolean) => {
    if (next) opener.current = document.activeElement;
    setOpenState(next);
  }, []);
  useEffect(() => {
    if (open) return;
    if (opener.current instanceof HTMLElement) opener.current.focus();
    opener.current = null;
  }, [open]);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [open, setOpen]);
  return <PaletteContext value={{ open, setOpen }}>{children}</PaletteContext>;
}

/** Whether the palette is open, for whatever must step aside while it is. */
export const useSearchPaletteOpen = () => usePalette().open;

/** The top bar's search pill: it opens the palette. */
export function SearchPaletteTrigger() {
  const { setOpen } = usePalette();
  return (
    <button
      type="button"
      className="sp-trigger"
      data-testid="search-trigger"
      onClick={() => setOpen(true)}
    >
      <SearchGlyph className="sp-trigger-icon" />
      <span>Search</span>
      <kbd className="sp-trigger-kbd">⌘K</kbd>
    </button>
  );
}

/**
 * The palette itself, mounted at the shell root: the top bar's backdrop-filter
 * would otherwise be the containing block that clips its fixed scrim.
 */
export function SearchPaletteOverlay() {
  const { open, setOpen } = usePalette();
  return open ? <PaletteOverlay onClose={() => setOpen(false)} /> : null;
}

// Debounced, and a newer query supersedes the one in flight; the last answer
// stays on screen while the next one loads.
function usePaletteSearch(query: string) {
  const settled = useDebounced(query).trim();
  const search = useQuery({
    ...paletteQuery(settled),
    enabled: settled !== "",
    placeholderData: keepPreviousData,
  });
  const results = settled && !search.isError ? search.data : undefined;
  return { results, search };
}

function PaletteOverlay({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser();
  const [query, setQuery] = useState("");
  const { results, search } = usePaletteSearch(query);
  // Matched on the client from the live query, so they need no debounce.
  const settings = matchingSettings(query, user.isAdmin);
  const total = (results?.total ?? 0) + settings.length;
  const groups = paletteGroups(results, settings);
  const items = groups.flatMap((group) => group.items);
  // Null until the reader arrows: Enter then searches instead of opening a row.
  const [held, setHeld] = useState<string | null>(null);
  const index = held === null ? null : selectedIndex(items, held);
  const highlighted = index === null ? null : (items[index] ?? null);
  const navigate = useNavigate();
  const go = (href: string) => {
    navigate(href);
    onClose();
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        return;
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const next = moveSelection(
          index,
          items.length,
          event.key === "ArrowDown" ? "down" : "up",
        );
        const item = next === null ? undefined : items[next];
        setHeld(item ? itemKey(item) : null);
        return;
      }
      case "Enter": {
        // A row the reader tabbed to is a link; let it open itself.
        if (event.target instanceof HTMLAnchorElement) return;
        event.preventDefault();
        if (highlighted) go(itemHref(highlighted));
        else if (query.trim()) go(searchHref(query.trim()));
        return;
      }
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Escape closes it from the keyboard; this is the pointer's way out
    <div
      className="sp-scrim"
      data-testid="sp-scrim"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="sp-panel"
        data-testid="sp-panel"
        role="dialog"
        aria-label="Search palette"
        aria-modal="true"
        onKeyDown={onKeyDown}
      >
        <div className="sp-input-wrap">
          <SearchGlyph size={18} className="sp-input-icon" />
          <input
            className="sp-input"
            data-testid="sp-input"
            type="text"
            placeholder="Search books, authors, series, tags, settings…"
            aria-label="Search"
            // biome-ignore lint/a11y/noAutofocus: the palette opens to type into
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHeld(null);
            }}
          />
          {search.isFetching && <Ring size="md" className="sp-spinner" />}
        </div>
        {results && (
          <div className="sp-meta" data-testid="sp-result-count">
            {total} result{plural(total)} · {results.durationMs}ms
          </div>
        )}
        {search.isError && (
          <p role="alert" className="sp-error error" data-testid="sp-error">
            Couldn’t run that search. Check your connection and try again.
          </p>
        )}
        {search.isFetching && !results && (
          <Loading kind="row" label="Searching" className="sp-loading" />
        )}
        <ResultsList
          groups={groups}
          highlighted={highlighted ? itemKey(highlighted) : null}
          onPick={onClose}
        />
        <div className="sp-footer">
          <div className="sp-footer-keys">
            <kbd>↑↓</kbd>
            <span> navigate</span>
            <kbd>⏎</kbd>
            <span> open</span>
            <kbd>esc</kbd>
            <span> close</span>
          </div>
          <div className="sp-footer-engine">fts5 · ranked by relevance</div>
        </div>
      </div>
    </div>
  );
}

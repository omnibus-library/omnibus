import { useState } from "react";
import { Loading } from "../../components/Loading/Loading";
import { DrawerShell } from "./DrawerShell";
import type { SearchResult } from "./epubGlue";

type SearchPanelProps = {
  results: SearchResult[];
  /** True from the query until the glue answers. */
  searching: boolean;
  onQuery: (query: string) => void;
  onNavigate: (cfi: string) => void;
  onClose: () => void;
};

const matches = (count: number) =>
  `${count} ${count === 1 ? "match" : "matches"} · in this book`;

/** The in-book search drawer; the glue walks the book and answers through `results`. */
export function SearchPanel({
  results,
  searching,
  onQuery,
  onNavigate,
  onClose,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  // "No matches." is only ever said of a search that ran.
  const [asked, setAsked] = useState(false);

  return (
    <DrawerShell
      testId="reader-search-drawer"
      // Lets the phone breakpoint take this one drawer full-screen while the rest stay bottom sheets.
      extraClass="rd-search-drawer"
      onClose={onClose}
      head={<h4 className="rd-drawer-title">Search</h4>}
    >
      <div className="rd-search-box">
        <input
          className="rd-search-input"
          type="text"
          data-testid="reader-search-input"
          aria-label="Search in book"
          placeholder="Search in book… (Enter)"
          // biome-ignore lint/a11y/noAutofocus: the drawer exists to take a query
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            setAsked(true);
            onQuery(query.trim());
          }}
        />
      </div>
      {!searching && results.length > 0 && (
        <div className="rd-search-count">{matches(results.length)}</div>
      )}
      <div className="rd-drawer-body">
        {searching ? (
          <Loading label="Searching the book" testId="reader-search-loading" />
        ) : results.length === 0 ? (
          <div className="rd-drawer-empty">
            {asked && query.trim() !== ""
              ? "No matches."
              : "Type a query and press Enter."}
          </div>
        ) : (
          results.map((hit) => (
            <button
              key={hit.cfi}
              type="button"
              className="rd-search-row"
              data-testid="reader-search-row"
              onClick={() => onNavigate(hit.cfi)}
            >
              {hit.chapter && (
                <span className="rd-search-chapter">{hit.chapter}</span>
              )}
              <span className="rd-search-excerpt">{hit.excerpt}</span>
            </button>
          ))
        )}
      </div>
    </DrawerShell>
  );
}

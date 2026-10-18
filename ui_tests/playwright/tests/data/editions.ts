export type ProviderId = "open_library" | "google_books" | "hardcover";

const DISPLAY_NAMES: Record<ProviderId, string> = {
  open_library: "Open Library",
  google_books: "Google Books",
  hardcover: "Hardcover",
};

/** One provider as the picker's catalog lists it (`ProviderInfo`). */
export type ProviderInfo = {
  id: ProviderId;
  display_name: string;
  configured: boolean;
  requires_key: boolean;
  capabilities: Record<string, boolean>;
};

/** One candidate a provider offers for the book (`ProviderEdition`). */
export type ProviderEdition = {
  source: ProviderId;
  provider_ref: string;
  isbn13: string | null;
  title: string;
  authors: string[];
  year: string | null;
  pages: number | null;
  publisher: string | null;
  description: string | null;
  cover_url: string | null;
  series: string | null;
  series_index: string | null;
  first_publish_year: number | null;
  genres: string[];
};

/** What one source reported back from a search. */
export type SourceStatus =
  | { kind: "answered"; count: number }
  | { kind: "not_configured" }
  | { kind: "failed"; message: string }
  | { kind: "throttled"; retry_after_secs: number };

export type SourceReport = {
  provider: ProviderId;
  display_name: string;
  status: SourceStatus;
};

/** A search's answer: the candidates and what each source contributed. */
export type EditionSearchResult = {
  editions: ProviderEdition[];
  sources: SourceReport[];
};

/** What the providers answer: the catalog, and a search's results if given. */
export type EditionAnswers = {
  catalog: ProviderInfo[];
  found?: EditionSearchResult;
};

/** The fields a search request carries, inside its `req` envelope. */
export type EditionSearchQuery = {
  query: string;
  title?: string;
  author?: string;
  isbn?: string;
};

export function provider(id: ProviderId, configured: boolean): ProviderInfo {
  return {
    id,
    display_name: DISPLAY_NAMES[id],
    configured,
    requires_key: id === "hardcover",
    capabilities: {
      search_by_title: true,
      search_by_isbn: true,
      carries_cover: true,
      carries_ratings: false,
      carries_genres: true,
    },
  };
}

export function source(id: ProviderId, status: SourceStatus): SourceReport {
  return { provider: id, display_name: DISPLAY_NAMES[id], status };
}

// A 1x1 transparent GIF, so a candidate's cover renders without reaching a host.
export const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export const ALL_CONFIGURED = [
  provider("open_library", true),
  provider("google_books", true),
  provider("hardcover", false),
];

export const NONE_CONFIGURED = [
  provider("open_library", false),
  provider("google_books", false),
  provider("hardcover", false),
];

export const HC_CONFIGURED = [
  provider("open_library", true),
  provider("google_books", true),
  provider("hardcover", true),
];

// Two candidates sharing an ISBN across two sources: the picker has to keep two
// sources' takes on one edition apart. Both titles account for every word of
// the seeded query, so the shorter one leads whichever provider answers first.
export const OL_CANDIDATE: ProviderEdition = {
  source: "open_library",
  provider_ref: "/works/OL42W",
  isbn13: "9781234567897",
  title: "Minor Lemmas II (Open Library)",
  authors: ["Sophie Germain"],
  year: "1815",
  pages: 212,
  publisher: "Klein Mathematik",
  description: null,
  cover_url: PIXEL,
  series: null,
  series_index: null,
  first_publish_year: 1815,
  genres: ["Mathematics"],
};

export const GB_CANDIDATE: ProviderEdition = {
  source: "google_books",
  provider_ref: "gb-volume-7",
  isbn13: "9781234567897",
  title: "Minor Lemmas II: A Longer Google Books Title",
  authors: ["Sophie Germain", "Emmy Noether"],
  year: "1816",
  pages: 220,
  publisher: "Editions Gauss",
  description: "A Google Books description.",
  cover_url: PIXEL,
  series: null,
  series_index: null,
  first_publish_year: null,
  genres: [],
};

// The only source that publishes a series position.
export const HC_CANDIDATE: ProviderEdition = {
  source: "hardcover",
  provider_ref: "hc-book-31",
  isbn13: "9789999888877",
  title: "Minor Lemmas II (Hardcover)",
  authors: ["Sophie Germain", "Sofya Kovalevskaya"],
  year: "1817",
  pages: 244,
  publisher: "Hardcover Press",
  description: "A Hardcover description.",
  cover_url: PIXEL,
  series: "Mathematica Majora",
  series_index: "7",
  first_publish_year: 1815,
  genres: ["Mathematics"],
};

export const OL_ANSWERED = source("open_library", {
  kind: "answered",
  count: 1,
});
export const GB_ANSWERED = source("google_books", {
  kind: "answered",
  count: 1,
});
export const HC_NOT_CONFIGURED = source("hardcover", {
  kind: "not_configured",
});

// Rows sort by title, so Google Books' longer one is second whichever order the
// fan-out answered in.
export const GB_ROW = 1;

// Provider-first order, as the fan-out returns it, so a test on row order is
// testing the client's sort rather than the server's concatenation.
export const FOUND: EditionSearchResult = {
  editions: [GB_CANDIDATE, OL_CANDIDATE],
  sources: [OL_ANSWERED, GB_ANSWERED, HC_NOT_CONFIGURED],
};

/** Every provider but Hardcover configured, and the search answering `FOUND`. */
export const STANDARD_ANSWERS: EditionAnswers = {
  catalog: ALL_CONFIGURED,
  found: FOUND,
};

export const HC_FOUND: EditionSearchResult = {
  editions: [HC_CANDIDATE],
  sources: [
    source("open_library", { kind: "answered", count: 0 }),
    source("google_books", { kind: "answered", count: 0 }),
    source("hardcover", { kind: "answered", count: 1 }),
  ],
};

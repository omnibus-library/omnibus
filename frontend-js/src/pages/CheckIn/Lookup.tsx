import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { googleBooksConfiguredQuery, searchProviders } from "../../api";
import type { ExternalBookMeta } from "../../api/generated/schemas";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { cleanIsbn, isbnRejection } from "./checkIn";
import { ExternalBookCard } from "./Screens";

/** The Open Library fallback disclaimer, shown once the server reports it has no Google Books key. */
export function ProviderNote() {
  const configured = useQuery(googleBooksConfiguredQuery).data;
  if (configured !== false) return null;
  return (
    <p
      className="check-in-provider-note"
      data-testid="check-in-google-books-note"
    >
      Without a Google Books API key, this search will use Open Library, which
      may not have the latest books or all ISBNs. Set up your Google Books API
      key in Administration › Integrations.
    </p>
  );
}

type SearchProps = {
  busy: boolean;
  onPick: (meta: ExternalBookMeta) => void;
  onError: (message: string | null) => void;
};

/** Title search over the providers, for a copy whose ISBN is unknown, unreadable or in no provider's index. */
function TitleSearch({ busy, onPick, onError }: SearchProps) {
  const [query, setQuery] = useState("");
  // Null until a search lands, so the empty line can't show before anyone has searched.
  const [results, setResults] = useState<ExternalBookMeta[] | null>(null);
  const search = useMutation({
    mutationFn: searchProviders,
    onMutate: () => onError(null),
    onSuccess: setResults,
    // The results stay on screen to retry from.
    onError: (e) => onError(`Could not search: ${e.message}`),
  });
  const trimmed = query.trim();
  return (
    <div className="check-in-search" data-testid="check-in-search">
      <form
        className="settings-form"
        data-testid="check-in-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !search.isPending) search.mutate(trimmed);
        }}
      >
        <div className="settings-field">
          <label htmlFor="check-in-search-query">Title</label>
          <input
            id="check-in-search-query"
            data-testid="check-in-search-query"
            type="search"
            autoComplete="off"
            placeholder="The Name of the Wind"
            value={query}
            disabled={busy || search.isPending}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="settings-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || search.isPending || !trimmed}
            aria-busy={search.isPending}
            data-testid="check-in-search-submit"
          >
            <BusyLabel
              busy={search.isPending}
              label="Search"
              busyLabel="Searching…"
            />
          </Button>
        </div>
      </form>
      {results?.length === 0 && (
        <p className="check-in-why" data-testid="check-in-search-empty">
          No books match that title. Check the spelling, or try just the main
          title.
        </p>
      )}
      {results && results.length > 0 && (
        <ul
          className="check-in-search-results"
          data-testid="check-in-search-results"
        >
          {results.map((meta) => (
            <li key={meta.isbn13}>
              <button
                type="button"
                className="check-in-search-result"
                data-testid="check-in-search-result"
                disabled={busy}
                onClick={() => onPick(meta)}
              >
                <ExternalBookCard meta={meta} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Props = {
  isbn: string;
  busy: boolean;
  onIsbn: (isbn: string) => void;
  onResolve: (raw: string) => void;
} & SearchProps;

/** The front door: the ISBN off the back cover and a title search, together. */
export function LookupScreen({
  isbn,
  busy,
  onIsbn,
  onResolve,
  onPick,
  onError,
}: Props) {
  // Gated on the validator rather than on length, so a transposed digit is caught here, not a round trip later.
  const ready = isbnRejection(cleanIsbn(isbn)) === null;
  return (
    <div
      className="check-in-screen check-in-lookup"
      data-testid="check-in-lookup"
    >
      <h1>Check in a book</h1>
      <p className="subtitle">
        Enter the ISBN from the back cover, or search by title.
      </p>
      <form
        className="settings-form"
        data-testid="check-in-form"
        onSubmit={(e) => {
          e.preventDefault();
          onResolve(isbn);
        }}
      >
        <div className="settings-field">
          <label htmlFor="check-in-isbn">ISBN</label>
          <input
            id="check-in-isbn"
            data-testid="check-in-isbn"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="9780000000000"
            value={isbn}
            disabled={busy}
            onChange={(e) => onIsbn(e.target.value)}
          />
        </div>
        <div className="settings-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !ready}
            data-testid="check-in-submit"
          >
            Find book
          </Button>
        </div>
      </form>
      <p className="check-in-or" data-testid="check-in-or">
        or
      </p>
      <TitleSearch busy={busy} onPick={onPick} onError={onError} />
      <ProviderNote />
    </div>
  );
}

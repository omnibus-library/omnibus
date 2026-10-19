import { useQuery } from "@tanstack/react-query";
import { googleBooksConfiguredQuery } from "../../api";
import { Button } from "../../components/Button/Button";
import { cleanIsbn, isbnRejection } from "./checkIn";

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

type Props = {
  isbn: string;
  busy: boolean;
  onIsbn: (isbn: string) => void;
  onResolve: (raw: string) => void;
};

/** The front door: the ISBN off the back cover. */
export function LookupScreen({ isbn, busy, onIsbn, onResolve }: Props) {
  // Gated on the validator rather than on length, so a transposed digit is caught here, not a round trip later.
  const ready = isbnRejection(cleanIsbn(isbn)) === null;
  return (
    <div
      className="check-in-screen check-in-lookup"
      data-testid="check-in-lookup"
    >
      <h1>Check in a book</h1>
      <p className="subtitle">Enter the ISBN from the back cover.</p>
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
      <ProviderNote />
    </div>
  );
}

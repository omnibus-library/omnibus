import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { searchLibraryBooks } from "../../api";
import type { ScanBook } from "../../api/generated/schemas";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { truncationNote } from "./checkIn";
import { LibraryPickOption } from "./Screens";

type Props = {
  busy: boolean;
  onPick: (book: ScanBook) => void;
  onBack: () => void;
  onError: (message: string | null) => void;
};

/**
 * Link a copy to a book the library already holds: the way out for a copy no rung of the
 * matching ladder can bridge. The reader names the book instead of the matcher guessing.
 */
export function LinkExistingScreen({ busy, onPick, onBack, onError }: Props) {
  const [query, setQuery] = useState("");
  // Null until a search lands, so the empty line can't show before anyone has searched.
  const [found, setFound] = useState<{
    books: ScanBook[];
    total: number;
  } | null>(null);
  const search = useMutation({
    mutationFn: searchLibraryBooks,
    onMutate: () => onError(null),
    onSuccess: setFound,
    onError: (e) => onError(`Could not search your library: ${e.message}`),
  });
  const trimmed = query.trim();
  const note = found && truncationNote(found.books.length, found.total);
  return (
    <div className="check-in-screen" data-testid="check-in-link">
      <h1>Which book is this?</h1>
      <p className="subtitle">
        Find it in your library and we'll file this copy against it — no new
        book, no duplicate to merge later.
      </p>
      <form
        className="settings-form"
        data-testid="check-in-link-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !search.isPending) search.mutate(trimmed);
        }}
      >
        <div className="settings-field">
          <label htmlFor="check-in-link-query">Title or author</label>
          <input
            id="check-in-link-query"
            data-testid="check-in-link-query"
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
            data-testid="check-in-link-submit"
          >
            <BusyLabel
              busy={search.isPending}
              label="Search my library"
              busyLabel="Searching…"
            />
          </Button>
        </div>
      </form>
      {found?.books.length === 0 && (
        <p className="check-in-why" data-testid="check-in-link-empty">
          No book in your library matches that. Try the author's name, or a
          distinctive word from the title.
        </p>
      )}
      {found && found.books.length > 0 && (
        <ul className="check-in-match-list" data-testid="check-in-link-results">
          {found.books.map((book) => (
            <LibraryPickOption
              key={book.uuid}
              book={book}
              label="This one"
              testId="check-in-link-pick"
              onPick={onPick}
            />
          ))}
        </ul>
      )}
      {note && (
        <p className="check-in-why" data-testid="check-in-link-truncated">
          {note}
        </p>
      )}
      <div className="settings-actions">
        <Button
          variant="ghost"
          disabled={busy}
          data-testid="check-in-link-back"
          onClick={onBack}
        >
          Back
        </Button>
      </div>
    </div>
  );
}

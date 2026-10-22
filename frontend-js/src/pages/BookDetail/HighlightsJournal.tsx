import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { BookDetail } from "../../api";
import { Button } from "../../components/Button/Button";
import { EmptyNote } from "./EmptyNote";
import { Highlights } from "./Highlights";
import { Journal } from "./Journal";
import { NewJournalEntryModal } from "./JournalComposer";
import { highlightsQuery, journalQuery, useWish } from "./queries";
import "./HighlightsJournal.css";

/** The tab's two columns, the reader's passages beside the household's journal; with both empty, one note for the pair. */
export function HighlightsJournal({ book }: { book: BookDetail }) {
  const wish = useWish(book);
  // The columns read the same keys, so these cost nothing more than a look at their answers.
  const highlights = useQuery({
    ...highlightsQuery(book.uuid),
    enabled: !wish,
  });
  const journal = useQuery({ ...journalQuery(book.uuid), enabled: !wish });
  const [composing, setComposing] = useState(false);
  // Not for a wished book: its reads stop, but whatever they answered before the wish landed stays.
  const bothEmpty =
    !wish && highlights.data?.length === 0 && journal.data?.length === 0;
  return (
    <>
      {bothEmpty ? (
        <div className="bp-hj is-solo" data-testid="highlights-journal-empty">
          <EmptyNote
            heading="h2"
            title="No highlights or journal entries"
            action={
              <Button
                data-testid="journal-open-composer"
                onClick={() => setComposing(true)}
              >
                New journal entry
              </Button>
            }
          >
            Highlight a passage while you read, or write the first entry in the
            shared journal.
          </EmptyNote>
        </div>
      ) : (
        <div className="bp-hj" data-testid="highlights-journal">
          <Highlights book={book} />
          <Journal book={book} onCompose={() => setComposing(true)} />
        </div>
      )}
      {composing && (
        <NewJournalEntryModal
          uuid={book.uuid}
          onClose={() => setComposing(false)}
        />
      )}
    </>
  );
}

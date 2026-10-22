import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type BookDetail as Detail, saveDescription } from "../../api";
import { FetchSummary } from "../../components/FetchSummary/FetchSummary";
import { descriptionOverflows, summaryIsSparse } from "../../format";
import { BookChips } from "./BookChips";
import type { BookDialog } from "./BookDialogs";
import { bookQuery } from "./queries";
import { Related } from "./Related";
import { YourReading } from "./YourReading";
import "./Overview.css";

function Description({ book }: { book: Detail }) {
  const [open, setOpen] = useState(false);
  if (!book.description) return null;
  const id = `bp-desc-${book.uuid}`;
  return (
    <>
      <div
        id={id}
        className={open ? "bp-description is-open" : "bp-description"}
        data-testid="book-description"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the API runs descriptions through ammonia, which the Dioxus page relies on too
        dangerouslySetInnerHTML={{ __html: book.description }}
      />
      {descriptionOverflows(book.description) && (
        <button
          type="button"
          className="bp-link-row"
          data-testid="book-description-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

/** The Overview tab: the description with its genres, tags and shelves, the reader's record, and the books around this one. */
export function Overview({
  book,
  onOpenDialog,
}: {
  book: Detail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  const client = useQueryClient();
  return (
    <>
      <div className="bp-split">
        <div>
          <Description book={book} />
          {summaryIsSparse(book.description ?? "") && (
            <FetchSummary
              uuid={book.uuid}
              onFetched={async (text) =>
                client.setQueryData(
                  bookQuery(book.uuid).queryKey,
                  await saveDescription(book.uuid, text),
                )
              }
            />
          )}
          <BookChips book={book} onOpenDialog={onOpenDialog} />
        </div>
        <YourReading book={book} />
      </div>
      <Related book={book} />
    </>
  );
}

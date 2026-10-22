import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type BookDetail as Detail, saveDescription } from "../../api";
import { Button } from "../../components/Button/Button";
import { Chip } from "../../components/Chip/Chip";
import { FetchSummary } from "../../components/FetchSummary/FetchSummary";
import { descriptionOverflows, summaryIsSparse } from "../../format";
import { bookQuery } from "./queries";
import { Related } from "./Related";
import { YourReading } from "./YourReading";

type ChipRowProps = {
  label: string;
  listClass: string;
  tone: "plain" | "genre";
  values: string[];
};

function ChipRow({ label, listClass, tone, values }: ChipRowProps) {
  if (values.length === 0) return null;
  return (
    <div className="bd-chip-row">
      <span className="label bd-chip-row-label">{label}</span>
      <ul className={listClass}>
        {values.map((value) => (
          <Chip key={value} tone={tone}>
            {value}
          </Chip>
        ))}
      </ul>
    </div>
  );
}

function Description({ book }: { book: Detail }) {
  const [open, setOpen] = useState(false);
  if (!book.description) return null;
  const id = `bdmq-desc-${book.uuid}`;
  return (
    <>
      <div
        id={id}
        className={open ? "bdmq-desc bd-desc is-open" : "bdmq-desc bd-desc"}
        data-testid="book-description"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the API runs descriptions through ammonia, which the Dioxus page relies on too
        dangerouslySetInnerHTML={{ __html: book.description }}
      />
      {descriptionOverflows(book.description) && (
        <Button
          variant="ghost"
          size="sm"
          className="bdmq-desc-toggle"
          data-testid="book-description-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </>
  );
}

/** The Overview tab: the description with its genres and tags, the reader's record, and the books around this one. */
export function Overview({ book }: { book: Detail }) {
  const client = useQueryClient();
  return (
    <>
      <div className="bp-split">
        <div>
          <div className="bdmq-chips">
            <ChipRow
              label="Genres"
              listClass="bd-tag-list bd-genre-list"
              tone="genre"
              values={book.genres}
            />
            <ChipRow
              label="Tags"
              listClass="bd-tag-list"
              tone="plain"
              values={book.subjects}
            />
          </div>
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
        </div>
        <YourReading book={book} />
      </div>
      <Related book={book} />
    </>
  );
}

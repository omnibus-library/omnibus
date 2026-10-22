import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { BookDetail } from "../../api";
import { PlusGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { useCurrentUser } from "../../session";
import { EmptyNote } from "./EmptyNote";
import { NewJournalEntryModal } from "./JournalComposer";
import { JournalEntryCard } from "./JournalEntryCard";
import { quietReadersNote } from "./journal";
import { journalQuery, reviewsQuery, useWish } from "./queries";
import "./HighlightsJournal.css";

const TITLE_ID = "bp-journal-title";

/** Everyone's journal entries, newest as the server orders them, each a card in the feed. */
export function Journal({ book }: { book: BookDetail }) {
  return useWish(book) ? (
    <section
      className="bp-journal"
      data-testid="journal-section"
      aria-labelledby={TITLE_ID}
    >
      <div className="bp-section-head">
        <h2 id={TITLE_ID}>Journal</h2>
      </div>
      <EmptyNote heading="h3" title="No entries yet" testId="journal-empty">
        The journal begins when you do. Find a copy first — check in when it
        arrives.
      </EmptyNote>
    </section>
  ) : (
    <JournalFeed book={book} />
  );
}

function JournalFeed({ book }: { book: BookDetail }) {
  const viewer = useCurrentUser();
  const feed = useQuery(journalQuery(book.uuid));
  // Who else rated, to say so when they have written nothing.
  const reviews = useQuery(reviewsQuery(book.uuid));
  const [composing, setComposing] = useState(false);
  const entries = feed.data;
  const writers = new Set(entries?.map((e) => e.author.id));
  const quiet = quietReadersNote(
    (reviews.data?.others ?? [])
      .filter((other) => !writers.has(other.reader.id))
      .map((other) => other.reader.name),
  );
  return (
    <section
      className="bp-journal"
      data-testid="journal-section"
      aria-labelledby={TITLE_ID}
    >
      <div className="bp-section-head">
        <h2 id={TITLE_ID}>
          Journal{" "}
          {entries && entries.length > 0 && (
            <span className="bp-count" data-testid="journal-count">
              {entries.length}
            </span>
          )}
        </h2>
        <button
          type="button"
          className="bp-link-row"
          data-testid="journal-open-composer"
          onClick={() => setComposing(true)}
        >
          <PlusGlyph />
          New entry
        </button>
      </div>
      {composing && (
        <NewJournalEntryModal
          uuid={book.uuid}
          onClose={() => setComposing(false)}
        />
      )}
      {entries === undefined ? (
        feed.isError ? (
          <div className="bd-journal-empty card" data-testid="journal-error">
            <p className="mono">
              The journal didn’t load — try reopening the book.
            </p>
          </div>
        ) : (
          <Loading
            kind="section"
            className="start"
            label="Gathering the entries"
          />
        )
      ) : entries.length === 0 ? (
        <EmptyNote heading="h3" title="No entries yet" testId="journal-empty">
          Be the first to write one — anyone reading this book can add to the
          journal.
        </EmptyNote>
      ) : (
        <>
          <ul className="bp-journal-list" data-testid="journal-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <JournalEntryCard
                  uuid={book.uuid}
                  entry={entry}
                  viewer={viewer}
                />
              </li>
            ))}
          </ul>
          {quiet && (
            <EmptyNote heading="h3" title="Household" testId="journal-quiet">
              {quiet}
            </EmptyNote>
          )}
        </>
      )}
    </section>
  );
}

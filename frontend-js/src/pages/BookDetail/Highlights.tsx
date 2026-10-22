import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type BookDetail, deleteHighlight, type Highlight } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import {
  ConfirmDialog,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import {
  DownloadGlyph,
  RotateGlyph,
  TrashGlyph,
} from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { QuoteCard } from "../../components/QuoteCard/QuoteCard";
import { formatLongDate } from "../../format";
import { EmptyNote } from "./EmptyNote";
import { highlightLocator, readerDeepLink } from "./highlightAnchors";
import { alignmentQuery, highlightsQuery, useWish } from "./queries";
import type { Chapter } from "./readout";
import "./HighlightsJournal.css";

function CopyAction({ text }: { text: string | null }) {
  const [label, setLabel] = useState("Copy");
  const copy = async () => {
    if (text === null) return;
    setLabel(
      await navigator.clipboard.writeText(text).then(
        () => "Copied",
        () => "Couldn't copy",
      ),
    );
    setTimeout(() => setLabel("Copy"), 1500);
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="highlight-copy"
      disabled={text === null}
      onClick={copy}
    >
      {label}
    </Button>
  );
}

type CardProps = {
  book: BookDetail;
  highlight: Highlight;
  chapters: readonly Chapter[];
  onSaveImage: (h: Highlight) => void;
  onDelete: (h: Highlight) => void;
};

/** A passage on a card that turns over to its shareable face, where "Save image…" opens the quote card editor. */
function HighlightCard({
  book,
  highlight,
  chapters,
  onSaveImage,
  onDelete,
}: CardProps) {
  const { anchor, color, note, text } = highlight;
  const locator = anchor && highlightLocator(anchor, chapters);
  const date = formatLongDate(highlight.createdAt);
  const author = book.authors[0];
  const [flipped, setFlipped] = useState(false);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  // The hidden face is inert and cannot take focus until it is the live one, so focus
  // follows the card only after React has rendered the turn.
  const turn = (toBack: boolean) => {
    flushSync(() => setFlipped(toBack));
    (toBack ? back : front).current
      ?.querySelector<HTMLElement>("[data-flip]")
      ?.focus();
  };
  return (
    <li
      className={flipped ? "bp-quote is-flipped" : "bp-quote"}
      data-testid="highlight-card"
      data-color={color}
    >
      <div className="bp-quote-inner">
        <div
          ref={front}
          className="bp-quote-face bp-quote-front"
          data-testid="highlight-front"
          inert={flipped}
        >
          <blockquote>{text ?? "(highlighted passage)"}</blockquote>
          {note && (
            <p className="bp-quote-note" data-testid="highlight-note">
              {note}
            </p>
          )}
          <p className="bp-quote-meta" data-testid="highlight-meta">
            {locator ? `${locator} · ${date}` : date}
          </p>
          <div className="bp-quote-actions">
            {anchor && (
              <ButtonLink
                to={readerDeepLink(highlight.bookUuid, anchor)}
                variant="ghost"
                size="sm"
                data-testid="highlight-open"
              >
                Open in book
              </ButtonLink>
            )}
            <Button
              variant="ghost"
              size="sm"
              data-flip
              data-testid="highlight-quote"
              // A passage saved before the text column has none to put on a card.
              disabled={text === null}
              onClick={() => turn(true)}
            >
              Make quote card
            </Button>
            <CopyAction text={text} />
            <Button
              variant="ghost"
              size="sm"
              className="bp-quote-delete"
              aria-label="Delete highlight"
              title="Delete highlight"
              data-testid="highlight-delete"
              onClick={() => onDelete(highlight)}
            >
              <TrashGlyph />
            </Button>
          </div>
        </div>
        <div
          ref={back}
          className="bp-quote-face bp-quote-back"
          data-testid="highlight-back"
          inert={!flipped}
        >
          <p className="bp-qc-text">{text}</p>
          <p className="bp-qc-cite">
            <strong>{book.title}</strong>
            {author && ` · ${author}`}
          </p>
          <div className="bp-qc-actions">
            <Button size="sm" onClick={() => onSaveImage(highlight)}>
              <DownloadGlyph />
              Save image…
            </Button>
            <Button size="sm" data-flip onClick={() => turn(false)}>
              <RotateGlyph />
              Flip back
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

/** The passages the reader saved, as cards that turn into quote cards, with open, copy and delete on each. */
export function Highlights({ book }: { book: BookDetail }) {
  return useWish(book) ? (
    <section className="bp-highlights" aria-labelledby={TITLE_ID}>
      <div className="bp-section-head">
        <h2 id={TITLE_ID}>Highlights</h2>
      </div>
      <EmptyNote
        heading="h3"
        title="No highlights yet"
        testId="highlights-empty"
      >
        Highlight while you read to keep lines here. Find a copy first — check
        in when it arrives.
      </EmptyNote>
    </section>
  ) : (
    <Passages book={book} />
  );
}

const TITLE_ID = "bp-highlights-title";

function Passages({ book }: { book: BookDetail }) {
  const client = useQueryClient();
  const { queryKey } = highlightsQuery(book.uuid);
  const highlights = useQuery(highlightsQuery(book.uuid));
  const hasText = book.hasEbook || book.hasComic || book.hasPdf;
  const alignment = useQuery({
    ...alignmentQuery(book.uuid),
    enabled: hasText,
  });
  const [deleting, setDeleting] = useState<Highlight | null>(null);
  const [quoting, setQuoting] = useState<Highlight | null>(null);
  const remove = useMutation({
    mutationFn: (highlight: Highlight) => deleteHighlight(highlight.id),
    // The row leaves only once the server has confirmed it.
    onSuccess: (_done, { id }) => {
      client.setQueryData<Highlight[]>(queryKey, (old) =>
        old?.filter((h) => h.id !== id),
      );
      setDeleting(null);
    },
  });
  const list = highlights.data;
  return (
    <section
      className="bp-highlights"
      data-testid="highlights-section"
      aria-labelledby={TITLE_ID}
    >
      <div className="bp-section-head">
        <h2 id={TITLE_ID}>
          Highlights{" "}
          {list && list.length > 0 && (
            <span className="bp-count" data-testid="highlights-count">
              {list.length}
            </span>
          )}
        </h2>
      </div>
      {list === undefined ? (
        highlights.isError ? (
          <div className="bd-journal-empty card" data-testid="highlights-error">
            <p className="mono">
              Your saved passages didn’t load — try reopening the book.
            </p>
          </div>
        ) : (
          <Loading
            kind="section"
            className="start"
            label="Finding your passages"
          />
        )
      ) : list.length === 0 ? (
        <EmptyNote
          heading="h3"
          title="No highlights yet"
          testId="highlights-empty"
        >
          Highlight while you read to keep passages here.
        </EmptyNote>
      ) : (
        <ul className="bp-quote-list" data-testid="highlights-list">
          {list.map((highlight) => (
            <HighlightCard
              key={highlight.id}
              book={book}
              highlight={highlight}
              chapters={alignment.data?.chapters ?? []}
              onSaveImage={setQuoting}
              onDelete={(h) => {
                remove.reset();
                setDeleting(h);
              }}
            />
          ))}
        </ul>
      )}
      {quoting && (
        <ConfirmModal
          testId="quote-card-modal"
          ariaLabel="Make a quote card"
          dialogClass="mg-modal bd-quote-modal"
          busy={false}
          onDismiss={() => setQuoting(null)}
          focusOnOpen
        >
          <QuoteCard
            text={quoting.text ?? ""}
            author={book.authors[0] ?? ""}
            subtitle={book.title}
            // The reader's fallback for a book with no accent.
            accent={book.accent ?? "#3a3027"}
            onClose={() => setQuoting(null)}
          />
        </ConfirmModal>
      )}
      {deleting && (
        <ConfirmDialog
          testId="highlight-delete-modal"
          title="Delete this passage?"
          body="It will be removed from your saved passages. This can't be undone."
          action="Delete"
          busyLabel="Deleting…"
          busy={remove.isPending}
          note={
            remove.isError && (
              <p
                className="bd-merge-error"
                role="alert"
                data-testid="highlight-delete-error"
              >
                Couldn't delete the passage: {remove.error.message}
              </p>
            )
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting)}
        />
      )}
    </section>
  );
}

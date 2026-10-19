import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { type BookDetail, deleteHighlight, type Highlight } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { Loading } from "../../components/Loading/Loading";
import { formatLongDate } from "../../format";
import { highlightLocator, passagesKicker, readerDeepLink } from "./highlights";
import { alignmentQuery, highlightsQuery } from "./queries";
import type { Chapter } from "./readout";

function SectionHead({ kicker }: { kicker: string }) {
  return (
    <div className="bd-section-head">
      <div className="bd-section-head-text">
        <div className="label bd-section-kicker">{kicker}</div>
        <h3 className="bd-section-title">Passages you saved</h3>
      </div>
    </div>
  );
}

function CopyAction({ text }: { text: string | null }) {
  const [label, setLabel] = useState("copy");
  const copy = async () => {
    if (text === null) return;
    setLabel(
      await navigator.clipboard.writeText(text).then(
        () => "copied",
        () => "couldn't copy",
      ),
    );
    setTimeout(() => setLabel("copy"), 1500);
  };
  return (
    <button
      type="button"
      className="bd-hl-act"
      data-testid="highlight-copy"
      disabled={text === null}
      onClick={copy}
    >
      {label}
    </button>
  );
}

type CardProps = {
  highlight: Highlight;
  chapters: readonly Chapter[];
  onDelete: (h: Highlight) => void;
};

function HighlightCard({ highlight, chapters, onDelete }: CardProps) {
  const { anchor, color, note, text } = highlight;
  const locator = anchor && highlightLocator(anchor, chapters);
  const saved = `saved ${formatLongDate(highlight.createdAt)}`;
  return (
    <article
      className="card bd-hl-card"
      data-testid="highlight-card"
      data-color={color}
      style={{ borderLeftColor: `var(--hl-${color})` }}
    >
      <blockquote className="bd-hl-quote">
        “{text ?? "(highlighted passage)"}”
      </blockquote>
      {note && (
        <p className="bd-hl-note" data-testid="highlight-note">
          {note}
        </p>
      )}
      <div className="bd-hl-foot">
        <span className="mono bd-hl-meta" data-testid="highlight-meta">
          {locator ? `${locator} · ${saved}` : saved}
        </span>
        <div className="bd-hl-actions">
          {anchor && (
            <Link
              to={readerDeepLink(highlight.bookUuid, anchor)}
              className="bd-hl-act"
              data-testid="highlight-open"
            >
              open in book →
            </Link>
          )}
          <CopyAction text={text} />
          <button
            type="button"
            className="bd-hl-act bd-hl-delete"
            data-testid="highlight-delete"
            onClick={() => onDelete(highlight)}
          >
            delete
          </button>
        </div>
      </div>
    </article>
  );
}

/** Stop 03: the passages the reader saved, with open, copy and delete on each. */
export function HighlightsStop({ book }: { book: BookDetail }) {
  const client = useQueryClient();
  const { queryKey } = highlightsQuery(book.uuid);
  const highlights = useQuery(highlightsQuery(book.uuid));
  const hasText = book.hasEbook || book.hasComic || book.hasPdf;
  const alignment = useQuery({
    ...alignmentQuery(book.uuid),
    enabled: hasText,
  });
  const [deleting, setDeleting] = useState<Highlight | null>(null);
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
    <div className="bd-highlights" data-testid="highlights-section">
      <SectionHead
        kicker={list ? passagesKicker(list.length) : "Saved passages"}
      />
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
        <div className="bd-journal-empty card" data-testid="highlights-empty">
          <p className="mono">
            No saved passages yet — highlight while you read to keep them here.
          </p>
        </div>
      ) : (
        <div className="bd-hl-list" data-testid="highlights-list">
          {list.map((highlight) => (
            <HighlightCard
              key={highlight.id}
              highlight={highlight}
              chapters={alignment.data?.chapters ?? []}
              onDelete={(h) => {
                remove.reset();
                setDeleting(h);
              }}
            />
          ))}
        </div>
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
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { BookDetail, JournalEntry } from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmModal } from "../../components/ConfirmModal/ConfirmModal";
import { Loading } from "../../components/Loading/Loading";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { formatLongDate } from "../../format";
import { useCurrentUser } from "../../session";
import { JournalComposer } from "./JournalComposer";
import { JournalEntryCard } from "./JournalEntryCard";
import { journalExcerpt, marqueeJournalKicker } from "./journal";
import { journalQuery, useWish } from "./queries";

const MAX_STACKED = 5;

function LadderRow({
  entry,
  viewerId,
  onOpen,
}: {
  entry: JournalEntry;
  viewerId: number;
  onOpen: () => void;
}) {
  const date = formatLongDate(entry.createdAt);
  const isDraft = entry.status === "draft";
  return (
    <button
      type="button"
      className={isDraft ? "bdmq-lrow draft" : "bdmq-lrow"}
      data-testid="journal-ladder-row"
      onClick={onOpen}
    >
      <UserAvatar
        user={entry.author}
        className="bdmq-lrow-avatar"
        photoClassName="bdmq-lrow-avatar-photo"
      />
      <span className="bdmq-lrow-body">
        <span className="bdmq-lrow-head">
          <span className="nm">{entry.author.name}</span>
          {entry.author.id === viewerId && (
            <span className="nm bdmq-lrow-you">· you</span>
          )}
          {isDraft && (
            <span
              className="bdmq-draftchip"
              data-testid="journal-draft-chip-row"
            >
              Draft
            </span>
          )}
          <span className="at">
            {entry.progress === null ? date : `${date} · at ${entry.progress}%`}
          </span>
        </span>
        <span className="ex">
          {journalExcerpt(entry.bodyMd)}{" "}
          <span className="bdmq-lrow-read">read →</span>
        </span>
      </span>
    </button>
  );
}

/** Stop 04: everyone's journal entries as a ladder of excerpts, each opening its full card. */
export function JournalStop({ book }: { book: BookDetail }) {
  return useWish(book) ? (
    <div
      id="journal"
      className="bd-journal bdmq-journal"
      data-testid="journal-section"
    >
      <div className="bdmq-journalhead">
        <div className="bdmq-k" data-testid="journal-kicker">
          Empty
        </div>
      </div>
      <div className="bdmq-bigquiet">
        No entries yet — the journal begins when you do.
      </div>
      <p className="mono bdmq-quiet-hint">
        a shared log — anyone reading this book can write here
      </p>
    </div>
  ) : (
    <Journal book={book} />
  );
}

function Journal({ book }: { book: BookDetail }) {
  const viewer = useCurrentUser();
  const feed = useQuery(journalQuery(book.uuid));
  // By id, not position: a refetch keeps the same entry open, or drops it if it went away.
  const [openId, setOpenId] = useState<number | null>(null);
  // An open edit holds the overlay, so Escape and the backdrop cannot discard it.
  const [editing, setEditing] = useState(false);
  const closeOverlay = () => {
    setOpenId(null);
    setEditing(false);
  };
  const [composing, setComposing] = useState(false);
  const entries = feed.data;
  const drafts = entries?.filter((e) => e.status === "draft").length ?? 0;
  const readers = [
    ...new Map((entries ?? []).map((e) => [e.author.id, e.author])).values(),
  ];
  const opened = entries?.find((e) => e.id === openId);
  return (
    <div
      id="journal"
      className="bd-journal bdmq-journal"
      data-testid="journal-section"
    >
      <div className="bdmq-journalhead">
        <div className="bdmq-k" data-testid="journal-kicker">
          {entries ? (
            marqueeJournalKicker(
              entries.length - drafts,
              readers.length,
              drafts,
            )
          ) : (
            <span className="ld-sheen">Counting entries</span>
          )}
        </div>
        <span className="bdmq-headspacer" />
        <Button
          size="sm"
          data-testid="journal-open-composer"
          onClick={() => setComposing(true)}
        >
          ✎ New entry
        </Button>
        {readers.length > 1 && (
          <div className="bdmq-avatarstack" aria-hidden="true">
            {readers.slice(0, MAX_STACKED).map((reader) => (
              <UserAvatar
                key={reader.id}
                user={reader}
                className="bdmq-stack-avatar"
                photoClassName="bdmq-stack-avatar-photo"
              />
            ))}
          </div>
        )}
      </div>
      {composing && (
        // Not dismissable by a click outside: a stray one must not throw away an open draft.
        <ConfirmModal
          testId="journal-composer-overlay"
          ariaLabel="New journal entry"
          backdropClass="bdmq-overlay bdmq-overlay-static"
          dialogClass="bdmq-ocard bdmq-ocard-composer"
          busy
          onDismiss={() => setComposing(false)}
          focusOnOpen
        >
          <JournalComposer
            uuid={book.uuid}
            onClose={() => setComposing(false)}
          />
        </ConfirmModal>
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
        <div className="bd-journal-empty card" data-testid="journal-empty">
          <p className="mono">
            No journal entries yet — be the first to write one.
          </p>
        </div>
      ) : (
        <div className="bdmq-ladder" data-testid="journal-list">
          {entries.map((entry) => (
            <LadderRow
              key={entry.id}
              entry={entry}
              viewerId={viewer.id}
              onOpen={() => setOpenId(entry.id)}
            />
          ))}
        </div>
      )}
      {opened && (
        <ConfirmModal
          testId="journal-overlay"
          ariaLabel="Journal entry"
          backdropClass="bdmq-overlay"
          dialogClass="bdmq-ocard"
          busy={editing}
          onDismiss={closeOverlay}
          focusOnOpen
        >
          <JournalEntryCard
            uuid={book.uuid}
            entry={opened}
            viewer={viewer}
            onEditingChange={setEditing}
          />
          <Button
            variant="ghost"
            size="sm"
            className="bdmq-ocard-close"
            data-testid="journal-overlay-close"
            onClick={closeOverlay}
          >
            ✕ Close
          </Button>
        </ConfirmModal>
      )}
    </div>
  );
}

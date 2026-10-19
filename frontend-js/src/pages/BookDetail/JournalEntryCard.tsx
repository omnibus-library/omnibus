import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import {
  type BookUuid,
  deleteJournalEntry,
  type JournalEntry,
  publishJournalEntry,
  type User,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { formatLongDate } from "../../format";
import { isLongEntry } from "./journal";
import { journalQuery } from "./queries";

const SPOILER = "spoiler";
const SPOILER_TEXT = "spoiler-text";

// The sanitiser emits a spoiler as an inline `role="button"` span, which has no native
// activation. Revealing it also hands its text to assistive tech, which it hid until now.
function toggleSpoiler(spoiler: Element) {
  const revealed = spoiler.classList.toggle("revealed");
  spoiler.setAttribute("aria-expanded", String(revealed));
  const text = spoiler.querySelector(`:scope > .${SPOILER_TEXT}`);
  if (!text) return;
  if (revealed) {
    spoiler.removeAttribute("aria-label");
    text.removeAttribute("aria-hidden");
  } else {
    spoiler.setAttribute("aria-label", "Reveal spoiler");
    text.setAttribute("aria-hidden", "true");
  }
}

const spoilerOf = (event: { target: EventTarget }) =>
  event.target instanceof Element ? event.target.closest(`.${SPOILER}`) : null;

// One handler per body, delegated: the spoilers are inside server-rendered HTML.
const revealOnClick = (event: MouseEvent) => {
  const spoiler = spoilerOf(event);
  if (spoiler) toggleSpoiler(spoiler);
};

const revealOnKey = (event: KeyboardEvent) => {
  const spoiler = spoilerOf(event);
  if (
    (event.key !== "Enter" && event.key !== " ") ||
    !spoiler?.matches('[role="button"]')
  )
    return;
  // Space would scroll the page.
  event.preventDefault();
  toggleSpoiler(spoiler);
};

type JournalEntryCardProps = {
  uuid: BookUuid;
  entry: JournalEntry;
  viewer: User;
  /** Whether a long body may open clipped behind a Show more. False where opening the card was the request for the whole entry. */
  collapsible?: boolean;
};

/** One journal entry: byline, rendered body, and for its author Publish (a draft) and Delete. */
export function JournalEntryCard({
  uuid,
  entry,
  viewer,
  collapsible = true,
}: JournalEntryCardProps) {
  const client = useQueryClient();
  const refetchFeed = () =>
    client.invalidateQueries({ queryKey: journalQuery(uuid).queryKey });
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const publish = useMutation({
    mutationFn: publishJournalEntry,
    onSuccess: refetchFeed,
  });
  const remove = useMutation({
    mutationFn: deleteJournalEntry,
    onSuccess: async () => {
      await refetchFeed();
      setConfirming(false);
    },
  });
  const isOwner = entry.author.id === viewer.id;
  const isDraft = entry.status === "draft";
  const clipped = collapsible && isLongEntry(entry.bodyMd) && !expanded;
  const date = formatLongDate(entry.createdAt);
  return (
    <article className="card bd-journal-entry" data-testid="journal-entry">
      <div className="bd-journal-entry-head">
        <UserAvatar
          user={entry.author}
          className="bd-journal-avatar"
          photoClassName="bd-journal-avatar-photo"
        />
        <div className="bd-journal-entry-meta">
          <div className="bd-journal-entry-byline">
            <span className="bd-journal-author">{entry.author.name}</span>
            {isOwner && <span className="chip bd-journal-you">you</span>}
            {isDraft && (
              <span
                className="chip bd-journal-draft"
                data-testid="journal-draft-chip"
              >
                Draft
              </span>
            )}
          </div>
          <div className="mono bd-journal-entry-date">
            {entry.progress === null ? date : `${date} · at ${entry.progress}%`}
          </div>
        </div>
        {isOwner && (
          <div className="bd-journal-entry-actions">
            {isDraft && (
              <Button
                variant="primary"
                size="sm"
                data-testid="journal-publish-draft"
                disabled={publish.isPending}
                onClick={() => publish.mutate(entry)}
              >
                Publish
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="bd-journal-delete"
              data-testid="journal-delete"
              disabled={remove.isPending}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: delegates to the spoilers inside the server-rendered body */}
      <div
        onClick={revealOnClick}
        onKeyDown={revealOnKey}
        className={
          clipped
            ? "bd-journal-entry-body bd-journal-entry-body-collapsed"
            : "bd-journal-entry-body"
        }
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the server renders and sanitises journal markdown, as the Dioxus page relies on
        dangerouslySetInnerHTML={{ __html: entry.bodyHtml }}
      />
      {clipped && (
        <Button
          variant="ghost"
          size="sm"
          className="bd-journal-show-more"
          data-testid="journal-show-more"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          Show more ↓
        </Button>
      )}
      {publish.isError && (
        <span className="mono bd-journal-error" role="alert">
          {publish.error.message}
        </span>
      )}
      {confirming && (
        <ConfirmDialog
          testId="journal-delete-modal"
          title="Delete entry?"
          body="Deleting this journal entry removes it for good. This can’t be undone."
          action="Delete"
          busyLabel="Deleting…"
          busy={remove.isPending}
          note={
            remove.isError && (
              <p className="bd-merge-error" role="alert">
                {remove.error.message}
              </p>
            )
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => remove.mutate(entry.id)}
        />
      )}
    </article>
  );
}

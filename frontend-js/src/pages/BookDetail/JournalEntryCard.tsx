import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  type BookUuid,
  deleteJournalEntry,
  type JournalEntry,
  publishJournalEntry,
  type User,
  updateJournalEntry,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { BusyLabel } from "../../components/Loading/Loading";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { formatLongDate } from "../../format";
import {
  type EditorHandle,
  JournalEditor,
  JournalToolbar,
} from "./JournalEditor";
import { journalQuery } from "./queries";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { useClampOverflow } from "./useClampOverflow";
import "./HighlightsJournal.css";

/** An entry's body in the live editor; Save keeps its status and progress. */
function EditForm({
  uuid,
  entry,
  onDone,
}: {
  uuid: BookUuid;
  entry: JournalEntry;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const editor = useRef<EditorHandle>(null);
  const [body, setBody] = useState(entry.bodyMd);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      updateJournalEntry(entry.id, {
        bodyMd: body,
        progress: entry.progress,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: journalQuery(uuid).queryKey,
      });
      onDone();
    },
  });
  const error = save.error?.message ?? uploadError;
  return (
    <>
      <div className="bd-journal-toolbar-row">
        <JournalToolbar editor={editor} onError={setUploadError} />
      </div>
      <JournalEditor
        ref={editor}
        initial={entry.bodyMd}
        onChange={setBody}
        label="Edit journal entry"
        testId="journal-edit-editor"
      />
      <div className="bd-journal-entry-foot">
        {error && (
          <span className="mono bd-journal-error" role="alert">
            {error}
          </span>
        )}
        <span className="bd-journal-foot-spacer" />
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          data-testid="journal-edit-save"
          disabled={save.isPending || !body.trim()}
          aria-busy={save.isPending}
          onClick={() => save.mutate()}
        >
          <BusyLabel busy={save.isPending} label="Save" busyLabel="Saving…" />
        </Button>
      </div>
    </>
  );
}

type JournalEntryCardProps = {
  uuid: BookUuid;
  entry: JournalEntry;
  viewer: User;
};

/** One journal entry in the feed: byline, its body clamped to two lines, and for its author Publish (a draft), Edit and Delete. */
export function JournalEntryCard({
  uuid,
  entry,
  viewer,
}: JournalEntryCardProps) {
  const client = useQueryClient();
  const refetchFeed = () =>
    client.invalidateQueries({ queryKey: journalQuery(uuid).queryKey });
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const overflowing = useClampOverflow(
    body,
    !expanded && !editing,
    entry.bodyHtml ?? entry.bodyMd,
  );
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
  const date = formatLongDate(entry.createdAt);
  return (
    <article
      className="bp-panel bp-entry bp-journal-entry"
      data-testid="journal-entry"
    >
      <UserAvatar
        user={entry.author}
        className="bp-avatar"
        photoClassName="bp-avatar-photo"
      />
      <div className="bp-entry-main">
        <p className="bp-entry-meta">
          <strong>{entry.author.name}</strong>
          {isOwner && <span className="bp-entry-tag">you</span>}
          {isDraft && (
            <span
              className="bp-entry-tag is-draft"
              data-testid="journal-draft-chip"
            >
              Draft
            </span>
          )}
          {` · ${date}`}
          {entry.progress !== null && ` · at ${entry.progress}%`}
        </p>
        {editing ? (
          <EditForm
            uuid={uuid}
            entry={entry}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            <div
              ref={body}
              className={
                expanded ? "bp-entry-text" : "bp-entry-text is-clamped"
              }
            >
              <RenderedMarkdown html={entry.bodyHtml} md={entry.bodyMd} />
            </div>
            <div className="bp-entry-foot">
              {(overflowing || expanded) && (
                <button
                  type="button"
                  className="bp-entry-more"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              )}
              {isOwner && (
                <div className="bp-entry-actions">
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
                    data-testid="journal-edit"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
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
          </>
        )}
        {publish.isError && (
          <span className="mono bd-journal-error" role="alert">
            {publish.error.message}
          </span>
        )}
      </div>
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

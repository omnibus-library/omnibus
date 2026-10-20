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
  /** Told when the edit form opens or closes, so a host can hold off dismissing it. */
  onEditingChange?: (editing: boolean) => void;
};

/** One journal entry: byline, rendered body, and for its author Publish (a draft) and Delete. */
export function JournalEntryCard({
  uuid,
  entry,
  viewer,
  onEditingChange,
}: JournalEntryCardProps) {
  const client = useQueryClient();
  const refetchFeed = () =>
    client.invalidateQueries({ queryKey: journalQuery(uuid).queryKey });
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const edit = (value: boolean) => {
    setEditing(value);
    onEditingChange?.(value);
  };
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
        {isOwner && !editing && (
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
              data-testid="journal-edit"
              onClick={() => edit(true)}
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
      {editing ? (
        <EditForm uuid={uuid} entry={entry} onDone={() => edit(false)} />
      ) : (
        <RenderedMarkdown html={entry.bodyHtml} md={entry.bodyMd} />
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

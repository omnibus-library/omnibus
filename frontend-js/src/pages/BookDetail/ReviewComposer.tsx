import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { BookUuid, MyReview, ReviewChange } from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { HighlightsPopover } from "./JournalComposer";
import {
  type EditorHandle,
  JournalEditor,
  JournalToolbar,
} from "./JournalEditor";
import { highlightBlockquote } from "./journalMarkdown";
import { draftChange, isNoChange } from "./reviews";

type FieldProps = {
  uuid: BookUuid;
  title: string;
  hint: string;
  initial: string;
  label: string;
  testId: string;
  placeholder: string;
  isPrivate?: boolean;
  onChange: (md: string) => void;
  onError: (message: string | null) => void;
};

/** One Markdown field with the journal's toolbar, image upload and "From highlights". */
function Field({
  uuid,
  title,
  hint,
  initial,
  label,
  testId,
  placeholder,
  isPrivate = false,
  onChange,
  onError,
}: FieldProps) {
  const editor = useRef<EditorHandle>(null);
  const titleId = useId();
  return (
    <section
      className={isPrivate ? "bd-review-field private" : "bd-review-field"}
      aria-labelledby={titleId}
      data-testid={`${testId}-field`}
    >
      <div className="bd-review-field-head">
        <span className="label bd-review-field-title" id={titleId}>
          {isPrivate && (
            <span className="bd-review-lock" aria-hidden="true">
              🔒
            </span>
          )}
          {title}
        </span>
        <span className="mono bd-review-field-hint">{hint}</span>
      </div>
      <div className="bd-journal-toolbar-row">
        <JournalToolbar editor={editor} onError={onError} />
        <HighlightsPopover
          uuid={uuid}
          onPick={(text) =>
            editor.current?.apply({
              op: "insert",
              text: highlightBlockquote(text),
            })
          }
        />
      </div>
      <JournalEditor
        ref={editor}
        initial={initial}
        onChange={onChange}
        label={label}
        testId={testId}
        placeholder={placeholder}
      />
    </section>
  );
}

type ReviewComposerProps = {
  uuid: BookUuid;
  mine: MyReview | null;
  /** Saves the change; the composer closes once it resolves and shows the error if it throws. */
  onSave: (change: ReviewChange) => Promise<unknown>;
  onClose: () => void;
};

/** Your review's text and private notes in the journal's editor, saved together on Save. */
export function ReviewComposer({
  uuid,
  mine,
  onSave,
  onClose,
}: ReviewComposerProps) {
  const [bodyMd, setBodyMd] = useState(mine?.bodyMd ?? "");
  const [notesMd, setNotesMd] = useState(mine?.notesMd ?? "");
  const [spoiler, setSpoiler] = useState(mine?.spoiler ?? false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const spoilerHintId = useId();
  const change = draftChange(mine, { bodyMd, notesMd, spoiler });
  // Not optimistic: the editor holds the draft until the server has it, so a refusal loses nothing.
  const save = useMutation({
    mutationFn: (next: ReviewChange) => onSave(next),
    onSuccess: onClose,
  });
  const error = save.error?.message ?? uploadError;
  return (
    <div
      className="card bd-journal-composer bd-review-composer"
      data-testid="review-composer"
    >
      <Field
        uuid={uuid}
        title="Your review"
        hint="every reader on this server can see it"
        initial={mine?.bodyMd ?? ""}
        label="Review text"
        testId="review-body-editor"
        placeholder="What did you make of it? Markdown supported."
        onChange={setBodyMd}
        onError={setUploadError}
      />
      {bodyMd.trim() !== "" && (
        <div className="bd-review-spoiler-check">
          <label className="bd-review-spoiler-label">
            <input
              type="checkbox"
              checked={spoiler}
              aria-describedby={spoilerHintId}
              data-testid="review-composer-spoiler"
              onChange={(event) => setSpoiler(event.target.checked)}
            />
            <span>Contains spoilers</span>
          </label>
          <span className="mono bd-review-field-hint" id={spoilerHintId}>
            readers who haven't finished see it folded away
          </span>
        </div>
      )}
      <Field
        uuid={uuid}
        title="Private notes"
        hint="only you can see these"
        initial={mine?.notesMd ?? ""}
        label="Private notes"
        testId="review-notes-editor"
        placeholder="Anything to remember for yourself."
        isPrivate
        onChange={setNotesMd}
        onError={setUploadError}
      />
      <div className="bd-journal-composer-foot">
        {error && (
          <span className="mono bd-journal-error" role="alert">
            {error}
          </span>
        )}
        <span className="bd-journal-foot-spacer" />
        <Button
          variant="ghost"
          size="sm"
          data-testid="review-composer-cancel"
          disabled={save.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          data-testid="review-composer-save"
          disabled={save.isPending || isNoChange(change)}
          aria-busy={save.isPending}
          onClick={() => {
            setUploadError(null);
            save.mutate(change);
          }}
        >
          <BusyLabel busy={save.isPending} label="Save" busyLabel="Saving…" />
        </Button>
      </div>
    </div>
  );
}

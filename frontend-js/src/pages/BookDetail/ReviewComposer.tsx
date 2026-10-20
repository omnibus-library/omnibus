import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
import { composerSeed, isNoChange, saveChange } from "./reviews";

const FIELDS = {
  body: {
    stem: "review-body",
    label: "Review text",
    placeholder:
      "What did you make of it? Everyone who opens this book can read this.",
  },
  notes: {
    stem: "review-notes",
    label: "Private notes",
    placeholder: "Notes to yourself — only you will ever see these.",
  },
} as const;

type FieldProps = {
  uuid: BookUuid;
  field: keyof typeof FIELDS;
  initial: string;
  onChange: (md: string) => void;
  onError: (message: string | null) => void;
};

/** One labelled Markdown field: its head, the journal's toolbar row with "From highlights", the editor. */
function ReviewField({ uuid, field, initial, onChange, onError }: FieldProps) {
  const editor = useRef<EditorHandle>(null);
  const { stem, label, placeholder } = FIELDS[field];
  const isPrivate = field === "notes";
  return (
    <div
      className={
        isPrivate
          ? "bd-review-field bd-review-field-private"
          : "bd-review-field"
      }
      data-testid={`${stem}-field`}
    >
      <div className="bd-review-field-head">
        <span className="label">{label}</span>
        <span className="bd-journal-foot-spacer" />
        {isPrivate ? (
          <span className="mono bd-review-private-tag">
            <span aria-hidden="true">🔒 </span>
            only you can see these
          </span>
        ) : (
          <span
            className="mono bd-journal-spoiler-help"
            title="Hide spoilers with ||double pipes|| — they appear blurred until clicked."
          >
            Spoilers? Wrap text in ||double pipes||
          </span>
        )}
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
        testId={`${stem}-editor`}
        placeholder={placeholder}
      />
    </div>
  );
}

type ReviewComposerProps = {
  uuid: BookUuid;
  mine: MyReview | null;
  /** Saves the change; the composer closes once it resolves and shows the error if it throws. */
  onSave: (change: ReviewChange) => Promise<unknown>;
  onClose: () => void;
};

/** Your review's public text (with the Contains spoilers flag under it) and private notes in the journal's editor, saved together on Save as one patch of what changed. */
export function ReviewComposer({
  uuid,
  mine,
  onSave,
  onClose,
}: ReviewComposerProps) {
  const [seed] = useState(() => composerSeed(mine));
  const [bodyMd, setBodyMd] = useState(seed.bodyMd);
  const [notesMd, setNotesMd] = useState(seed.notesMd);
  const [spoiler, setSpoiler] = useState(seed.spoiler);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Not optimistic: the rendered text comes from the server, so the editor holds the draft until then.
  const save = useMutation({
    mutationFn: (change: ReviewChange) => onSave(change),
    onSuccess: onClose,
  });
  const error = save.error?.message ?? uploadError;
  const submit = () => {
    const change = saveChange(seed, { bodyMd, notesMd, spoiler });
    if (isNoChange(change)) {
      onClose();
      return;
    }
    setUploadError(null);
    save.mutate(change);
  };
  return (
    <div
      className="card bd-journal-composer bd-review-composer"
      data-testid="review-composer"
    >
      <ReviewField
        uuid={uuid}
        field="body"
        initial={seed.bodyMd}
        onChange={setBodyMd}
        onError={setUploadError}
      />
      <label className="bd-review-spoiler" data-testid="review-spoiler">
        <input
          type="checkbox"
          checked={spoiler}
          onChange={(event) => setSpoiler(event.target.checked)}
        />
        Contains spoilers
      </label>
      <ReviewField
        uuid={uuid}
        field="notes"
        initial={seed.notesMd}
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
          data-testid="review-cancel"
          disabled={save.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          data-testid="review-save"
          disabled={save.isPending}
          aria-busy={save.isPending}
          onClick={submit}
        >
          <BusyLabel
            busy={save.isPending}
            label="Save review"
            busyLabel="Saving…"
          />
        </Button>
      </div>
    </div>
  );
}

import { useState } from "react";
import type { Highlight } from "../../api";
import { Button } from "../../components/Button/Button";
import { Scrim } from "./DrawerShell";

type NoteComposerProps = {
  highlight: Highlight;
  /** Saves the draft; the parent decides whether that closes the composer. */
  onSave: (draft: string) => void;
  onClose: () => void;
};

/** A small card over the page for the note on a highlight; the note is text, never markup. */
export function NoteComposer({
  highlight,
  onSave,
  onClose,
}: NoteComposerProps) {
  const [draft, setDraft] = useState(highlight.note ?? "");
  return (
    <>
      <Scrim onClick={onClose} />
      <div className="rd-note-composer" data-testid="reader-note-composer">
        <div className="rd-note-quote">{`“${highlight.text ?? "your highlight"}”`}</div>
        <textarea
          className="rd-note-input"
          data-testid="reader-note-input"
          aria-label="Note"
          placeholder="Add a note… (markdown ok)"
          // biome-ignore lint/a11y/noAutofocus: the composer exists to take the note
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="rd-note-actions">
          <span className="rd-note-hint">markdown ok</span>
          <div className="rd-note-buttons">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-testid="reader-note-save"
              onClick={() => onSave(draft)}
            >
              Save note
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

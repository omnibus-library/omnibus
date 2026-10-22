import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { leavePrompt, unsavedSummary } from "./dirty";

/** The Done button's id: where focus lands when the leave bar is dismissed and nothing better holds it. */
export const DONE_ID = "es-done";

type FooterProps = {
  /** Changes not yet saved: edited fields, and a held cover. */
  count: number;
  saving: boolean;
  /** Another write is in flight (a cover coming back): Done and Discard wait for it. */
  locked: boolean;
  /** A field's value is refused, so Done cannot save. */
  invalid: boolean;
  /** Why the last save did not land. */
  error: string | undefined;
  /** Close, Escape or Back came with changes unsaved: the bar asks instead. */
  leaving: boolean;
  onDone: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onDontSave: () => void;
  onSave: () => void;
};

const FIX = "Fix the highlighted field to save";

/** The sheet's foot: what is unsaved and Done, or the inline question when it is left unsaved, and the note on where edits go. */
export function SheetFooter({
  count,
  saving,
  locked,
  invalid,
  error,
  leaving,
  onDone,
  onDiscard,
  onKeepEditing,
  onDontSave,
  onSave,
}: FooterProps) {
  return (
    <footer className="es-foot">
      {leaving ? (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the bar never wants
        <div
          key="leave"
          className="es-bar es-leave"
          role="group"
          aria-labelledby="es-leave-text"
          data-testid="es-leave"
        >
          <p
            className="es-bar-text es-leave-text"
            id="es-leave-text"
            role="alert"
          >
            {leavePrompt(count)}
          </p>
          {error ? (
            <p className="es-bar-problem" role="alert">
              {error}
            </p>
          ) : (
            invalid && <p className="es-bar-problem">{FIX}</p>
          )}
          {/* The safe choice holds focus, so an Enter pressed in a hurry keeps the edits. */}
          {/* biome-ignore lint/a11y/noAutofocus: the bar asks a question, and focus belongs on its safest answer */}
          <Button
            autoFocus
            variant="ghost"
            disabled={locked}
            onClick={onKeepEditing}
          >
            Keep editing
          </Button>
          <Button disabled={locked} onClick={onDontSave}>
            Don’t save
          </Button>
          <Button
            variant="primary"
            aria-busy={saving}
            disabled={locked}
            onClick={onSave}
          >
            <BusyLabel busy={saving} label="Save" busyLabel="Saving…" />
          </Button>
        </div>
      ) : (
        <div key="bar" className={count > 0 ? "es-bar is-dirty" : "es-bar"}>
          <p
            className="es-bar-text es-save-state"
            role="status"
            data-testid="es-save-state"
          >
            {unsavedSummary(count)}
          </p>
          {error ? (
            <p className="es-bar-problem" role="alert">
              {error}
            </p>
          ) : (
            invalid && <p className="es-bar-problem">{FIX}</p>
          )}
          <Button
            variant="ghost"
            data-testid="es-discard"
            disabled={count === 0 || locked}
            onClick={onDiscard}
          >
            Discard edits
          </Button>
          <Button
            variant="primary"
            id={DONE_ID}
            data-testid="es-done"
            disabled={invalid || locked}
            aria-busy={saving}
            onClick={onDone}
          >
            <BusyLabel busy={saving} label="Done" busyLabel="Saving…" />
          </Button>
        </div>
      )}
      <p className="es-note">
        Omnibus never writes to your book files. Your edits are saved in the
        Omnibus library database.
      </p>
    </footer>
  );
}

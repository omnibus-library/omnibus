import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { leavePrompt, unsavedSummary } from "./dirty";

type FooterProps = {
  /** Changes not yet saved: edited fields, and a held cover. */
  count: number;
  saving: boolean;
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
          className="es-bar es-leave"
          role="group"
          aria-labelledby="es-leave-text"
          data-testid="es-leave"
        >
          <p className="es-bar-text es-leave-text" id="es-leave-text">
            {leavePrompt(count)}
          </p>
          {error ? (
            <p className="es-bar-problem" role="alert">
              {error}
            </p>
          ) : (
            invalid && <p className="es-bar-problem">{FIX}</p>
          )}
          <Button variant="ghost" disabled={saving} onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button disabled={saving} onClick={onDontSave}>
            Don’t save
          </Button>
          <Button
            variant="primary"
            aria-busy={saving}
            disabled={saving}
            onClick={onSave}
          >
            <BusyLabel busy={saving} label="Save" busyLabel="Saving…" />
          </Button>
        </div>
      ) : (
        <div className={count > 0 ? "es-bar is-dirty" : "es-bar"}>
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
            disabled={count === 0 || saving}
            onClick={onDiscard}
          >
            Discard edits
          </Button>
          <Button
            variant="primary"
            data-testid="es-done"
            disabled={invalid || saving}
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

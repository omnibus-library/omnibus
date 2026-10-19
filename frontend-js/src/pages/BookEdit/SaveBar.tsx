import type { BookUuid } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { editedSummary, saveLabel } from "./dirty";

/** What the bar's two actions mean. */
export type SaveBarMode =
  /** A saved book: Discard is a link back to it, and Save is offered once there is something to save. */
  | { kind: "edit"; uuid: BookUuid }
  /** An upload under review: Discard drops the pick, and the primary action adds the book untouched or not. */
  | { kind: "create" };

type Props = {
  mode: SaveBarMode;
  dirty: string[];
  /** A cover was replaced: already saved, but worth leaving through Save. */
  coverReplaced: boolean;
  saving: boolean;
  error: string | undefined;
  onSave: () => void;
  /** Edit: called as the Discard link is followed, before the router navigates. Create: the "Start over" press. */
  onDiscard: () => void;
};

/** The sticky bar under the form: what is edited, any error, and Discard and Save. */
export function SaveBar({
  mode,
  dirty,
  coverReplaced,
  saving,
  error,
  onSave,
  onDiscard,
}: Props) {
  const creating = mode.kind === "create";
  return (
    <div className="me-save-bar">
      {dirty.length > 0 ? (
        <>
          <span className="me-dirty-dot" />
          <span className="me-dirty-label">{editedSummary(dirty.length)}</span>
          <span className="mono me-dirty-names">{dirty.join(" · ")}</span>
        </>
      ) : coverReplaced ? (
        <span className="mono me-dirty-label" data-testid="me-cover-replaced">
          {creating
            ? "Cover replaced · saved with the book"
            : "Cover replaced · already saved"}
        </span>
      ) : (
        <span className="mono me-dirty-label" style={{ color: "var(--ink-3)" }}>
          No changes
        </span>
      )}
      {error && (
        <span
          className="mono"
          role="alert"
          style={{ color: "var(--bad)", fontSize: 12, marginLeft: 8 }}
        >
          {error}
        </span>
      )}
      <div className="me-save-actions">
        {mode.kind === "edit" ? (
          // Leaves the field edits unsent.
          <ButtonLink
            to={`/books/${mode.uuid}`}
            variant="ghost"
            data-testid="me-discard"
            onClick={onDiscard}
          >
            Discard edits
          </ButtonLink>
        ) : (
          <Button
            variant="ghost"
            data-testid="me-discard"
            disabled={saving}
            onClick={onDiscard}
          >
            Start over
          </Button>
        )}
        <Button
          variant="primary"
          data-testid="me-save"
          disabled={
            (!creating && dirty.length === 0 && !coverReplaced) || saving
          }
          aria-busy={saving}
          onClick={onSave}
        >
          <BusyLabel
            busy={saving}
            label={saveLabel(false, dirty.length, creating)}
            busyLabel={saveLabel(true, 0, creating)}
          />
        </Button>
      </div>
    </div>
  );
}

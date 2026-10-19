import type { BookUuid } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { editedSummary, saveLabel } from "./dirty";

type Props = {
  uuid: BookUuid;
  dirty: string[];
  /** A cover was replaced: already saved, but worth leaving through Save. */
  coverReplaced: boolean;
  saving: boolean;
  error: string | undefined;
  onSave: () => void;
  /** Called as the Discard link is followed, before the router navigates. */
  onDiscard: () => void;
};

/** The sticky bar under the form: what is edited, any error, and Discard and Save. */
export function SaveBar({
  uuid,
  dirty,
  coverReplaced,
  saving,
  error,
  onSave,
  onDiscard,
}: Props) {
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
          Cover replaced · already saved
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
        {/* Leaves the field edits unsent. */}
        <ButtonLink
          to={`/books/${uuid}`}
          variant="ghost"
          data-testid="me-discard"
          onClick={onDiscard}
        >
          Discard edits
        </ButtonLink>
        <Button
          variant="primary"
          data-testid="me-save"
          disabled={(dirty.length === 0 && !coverReplaced) || saving}
          aria-busy={saving}
          onClick={onSave}
        >
          <BusyLabel
            busy={saving}
            label={saveLabel(false, dirty.length)}
            busyLabel={saveLabel(true, 0)}
          />
        </Button>
      </div>
    </div>
  );
}

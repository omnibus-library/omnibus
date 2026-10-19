import type { BookUuid } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { editedSummary, saveLabel } from "./dirty";

type Props = {
  uuid: BookUuid;
  dirty: string[];
  saving: boolean;
  error: string | undefined;
  onSave: () => void;
};

/** The sticky bar under the form: what is edited, any error, and Discard and Save. */
export function SaveBar({ uuid, dirty, saving, error, onSave }: Props) {
  return (
    <div className="me-save-bar">
      {dirty.length > 0 ? (
        <>
          <span className="me-dirty-dot" />
          <span className="me-dirty-label">{editedSummary(dirty.length)}</span>
          <span className="mono me-dirty-names">{dirty.join(" · ")}</span>
        </>
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
        >
          Discard edits
        </ButtonLink>
        <Button
          variant="primary"
          data-testid="me-save"
          disabled={dirty.length === 0 || saving}
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

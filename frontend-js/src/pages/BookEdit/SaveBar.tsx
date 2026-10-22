import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { editedSummary, saveLabel } from "./dirty";

type Props = {
  dirty: string[];
  /** A cover was picked: saved with the book, so worth saying. */
  coverReplaced: boolean;
  saving: boolean;
  error: string | undefined;
  onSave: () => void;
  onStartOver: () => void;
};

/** The sticky bar under an upload's review form: what is edited, any error, Start over and Add to library. */
export function SaveBar({
  dirty,
  coverReplaced,
  saving,
  error,
  onSave,
  onStartOver,
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
          Cover replaced · saved with the book
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
        <Button
          variant="ghost"
          data-testid="me-discard"
          disabled={saving}
          onClick={onStartOver}
        >
          Start over
        </Button>
        <Button
          variant="primary"
          data-testid="me-save"
          disabled={saving}
          aria-busy={saving}
          onClick={onSave}
        >
          <BusyLabel
            busy={saving}
            label={saveLabel(false)}
            busyLabel={saveLabel(true)}
          />
        </Button>
      </div>
    </div>
  );
}

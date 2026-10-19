import type { EditableBook } from "../../api";
import { Button } from "../../components/Button/Button";

type Props = {
  book: EditableBook;
  saving: boolean;
  onRevert: () => void;
};

/** The identifiers and, when the book has edits, the card that reverts them. */
export function Sidebar({ book, saving, onRevert }: Props) {
  return (
    <aside className="me-sidebar">
      {book.identifiers.length > 0 && (
        <div className="card me-sidebar-card">
          <div className="label" style={{ marginBottom: 12 }}>
            Identifiers
          </div>
          <div className="me-ident-list">
            {book.identifiers.map((ident) => (
              <div
                key={`${ident.scheme}-${ident.value}`}
                className="me-ident-row"
              >
                <span className="label me-ident-key">
                  {ident.scheme ?? "ID"}
                </span>
                <span className="mono me-ident-val">{ident.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {book.hasOverride && (
        <div className="card me-sidebar-card">
          <div className="label" style={{ marginBottom: 8 }}>
            Override active
          </div>
          <p className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
            This book has metadata overrides. Saving will update them;
            discarding will leave existing overrides intact.
          </p>
          <Button
            variant="ghost"
            size="sm"
            style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
            data-testid="revert-overrides"
            disabled={saving}
            onClick={onRevert}
          >
            Revert to scanned values
          </Button>
        </div>
      )}
    </aside>
  );
}

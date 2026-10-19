import type { EditableBook } from "../../api";
import { Button } from "../../components/Button/Button";
import { CoverEditor, type CoverProps } from "./CoverEditor";

type Props = {
  /** The book as the server last reported it, which a cover write moves. */
  book: EditableBook;
  cover: CoverProps;
  saving: boolean;
  onRevert: () => void;
};

/** The cover, the identifiers and, when the book has edits, the card that reverts them. */
export function Sidebar({ book, cover, saving, onRevert }: Props) {
  return (
    <aside className="me-sidebar">
      <CoverEditor {...cover} />
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

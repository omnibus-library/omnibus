import type { Shelf } from "../../api";
import "./ShelfForm.css";

type Visibility = Shelf["visibility"];

/** The Private / Public segmented control in the create and edit shelf headers. */
export function VisibilityToggle({
  visibility,
  onChange,
}: {
  visibility: Visibility;
  onChange: (visibility: Visibility) => void;
}) {
  return (
    <div className="shelf-vis-toggle">
      <button
        type="button"
        className="shelf-toggle-btn"
        aria-pressed={visibility === "private"}
        data-testid="shelf-vis-private"
        onClick={() => onChange("private")}
      >
        Private
      </button>
      <button
        type="button"
        className="shelf-toggle-btn"
        aria-pressed={visibility === "public"}
        data-testid="shelf-vis-public"
        onClick={() => onChange("public")}
      >
        Public
      </button>
    </div>
  );
}

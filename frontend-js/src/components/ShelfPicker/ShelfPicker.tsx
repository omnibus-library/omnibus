import { Link } from "react-router";
import type { Shelf, User } from "../../api";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { Loading, Ring } from "../Loading/Loading";
import {
  accentStyle,
  ShelfTileFace,
  tileLabelledBy,
} from "../ShelfTile/ShelfTile";
import "./ShelfPicker.css";

/** What the picker lays out; `ready` once the shelves and the viewer are known. */
export type PickerList =
  | { status: "loading" }
  | { status: "failed" }
  | {
      status: "ready";
      /** The hand-picked shelves the viewer may change. */
      targets: Shelf[];
      /** The ids of those holding the book. */
      checked: number[];
      /** The smart shelves that hold it by rule, read-only. */
      automatic: Shelf[];
    };

type ShelfPickerProps = {
  list: PickerList;
  viewer: User;
  /** The tile whose write is in flight; every tile is inert while set. */
  busy: number | null;
  /** The last write's failure; the tiles keep their state. */
  error: string | null;
  onPick: (shelfId: number) => void;
  onClose: () => void;
};

function Tile({
  shelf,
  on,
  viewer,
  busy,
  onPick,
}: {
  shelf: Shelf;
  on: boolean;
  viewer: User;
  busy: number | null;
  onPick: (shelfId: number) => void;
}) {
  const working = busy === shelf.id;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the tile is a whole card; a checkbox input can't hold it
    <button
      type="button"
      className="shv-card shv-card--compact shelf-picker-tile"
      style={accentStyle(shelf)}
      role="checkbox"
      aria-checked={on}
      aria-busy={working}
      aria-labelledby={tileLabelledBy(viewer.id, shelf, "shelf-picker")}
      data-testid={`shelf-picker-tile-${shelf.id}`}
      disabled={busy !== null}
      onClick={() => onPick(shelf.id)}
    >
      <span className="shelf-picker-check" aria-hidden="true">
        {working ? <Ring size="xs" /> : on ? "✓" : null}
      </span>
      <ShelfTileFace shelf={shelf} viewerId={viewer.id} prefix="shelf-picker" />
    </button>
  );
}

function Body({
  list,
  viewer,
  busy,
  onPick,
  onClose,
}: Pick<ShelfPickerProps, "list" | "viewer" | "busy" | "onPick" | "onClose">) {
  switch (list.status) {
    case "loading":
      return <Loading kind="sheet" label="Gathering your shelves" />;
    case "failed":
      return (
        <p className="pick-state" data-testid="shelf-picker-unavailable">
          Your shelves didn’t load. Close this and try again.
        </p>
      );
    case "ready":
      return (
        <div className="shelf-picker-list">
          {list.targets.length === 0 ? (
            <div className="pick-state" data-testid="shelf-picker-empty">
              <p>You have no hand-picked shelves yet.</p>
              <p>
                Make one on the{" "}
                <Link to="/" className="bdmq-k-link" onClick={onClose}>
                  library page →
                </Link>
              </p>
            </div>
          ) : (
            <div className="shelf-picker-grid">
              {list.targets.map((shelf) => (
                <Tile
                  key={shelf.id}
                  shelf={shelf}
                  on={list.checked.includes(shelf.id)}
                  viewer={viewer}
                  busy={busy}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
          {list.automatic.length > 0 && (
            <section
              className="shelf-picker-automatic"
              data-testid="shelf-picker-automatic"
            >
              <h3 className="shelf-picker-auto-title">
                Automatic · follows each shelf's rules
              </h3>
              <div className="shelf-picker-grid">
                {list.automatic.map((shelf) => (
                  <div
                    key={shelf.id}
                    className="shv-card shv-card--compact shelf-picker-auto-tile"
                    style={accentStyle(shelf)}
                    data-testid={`shelf-picker-auto-${shelf.id}`}
                  >
                    <ShelfTileFace
                      shelf={shelf}
                      viewerId={viewer.id}
                      prefix="shelf-picker-auto"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      );
    default: {
      const _exhaustive: never = list;
      return _exhaustive;
    }
  }
}

/** The "Add to shelf" modal: hand-picked shelves as checkbox tiles, smart ones read-only below. */
export function ShelfPicker({
  list,
  viewer,
  busy,
  error,
  onPick,
  onClose,
}: ShelfPickerProps) {
  return (
    // Dismissing is held back while a write is in flight, so its failure is never closed unseen.
    <ConfirmModal
      testId="shelf-picker"
      ariaLabel="Add to shelf"
      backdropClass="shelf-modal-overlay"
      dialogClass="shelf-modal-card shelf-picker-card"
      busy={busy !== null}
      onDismiss={onClose}
      focusOnOpen
    >
      <div className="pick-head">
        <div>
          <span className="pick-kicker">Hand-picked shelves</span>
          <h2 className="pick-title" data-testid="shelf-picker-title">
            Add to shelf
          </h2>
        </div>
        <button
          type="button"
          className="pick-close"
          aria-label="Close"
          data-testid="shelf-picker-close"
          disabled={busy !== null}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <p className="shelf-picker-hint" data-testid="shelf-picker-hint">
        Only shelves you fill by hand are listed; smart shelves add books by
        their rules.
      </p>
      <Body
        list={list}
        viewer={viewer}
        busy={busy}
        onPick={onPick}
        onClose={onClose}
      />
      {error && (
        <p
          role="alert"
          className="shelf-modal-error"
          data-testid="shelf-picker-error"
        >
          {error}
        </p>
      )}
    </ConfirmModal>
  );
}

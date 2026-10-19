import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { type ShelfDetail, updateShelf } from "../../api";
import type {
  MatchMode,
  UpdateShelfRequest,
} from "../../api/generated/schemas";
import { Button } from "../Button/Button";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { BusyLabel } from "../Loading/Loading";
import { RuleBuilder } from "./RuleBuilder";
import {
  BLANK_DRAFT,
  fromRule,
  kindLabel,
  type RuleDraft,
  updateRequest,
} from "./rules";
import { VisibilityToggle } from "./VisibilityToggle";
import "../ShelfPicker/ShelfPicker.css";
import "./ShelfForm.css";

const KOBO = [
  [false, "Off", "edit-shelf-kobo-off"],
  [true, "On", "edit-shelf-kobo-on"],
] as const;

/** Name, visibility, the Kobo sync opt-in and (on a smart shelf) the rules, saved together. Kind is shown, never changed. */
export function EditShelfModal({
  shelf,
  onClose,
  onSaved,
}: {
  shelf: ShelfDetail;
  onClose: () => void;
  onSaved: (shelf: ShelfDetail) => void;
}) {
  const smart = shelf.kind === "smart";
  // A Wishlist is the system's: the server rejects the Kobo opt-in, so it is never offered.
  const showKobo = shelf.kind !== "wishlist";
  const [name, setName] = useState(shelf.name);
  const [visibility, setVisibility] = useState(shelf.visibility);
  const [syncToKobo, setSyncToKobo] = useState(shelf.syncToKobo);
  const [matchMode, setMatchMode] = useState<MatchMode>(
    shelf.matchMode ?? "all",
  );
  const [drafts, setDrafts] = useState<RuleDraft[]>(() =>
    shelf.rules.length > 0 ? shelf.rules.map(fromRule) : [BLANK_DRAFT],
  );
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: UpdateShelfRequest) => updateShelf(shelf.id, body),
    onSuccess: onSaved,
  });
  const error = invalid ?? (save.isError ? save.error.message : null);

  const submit = () => {
    const result = updateRequest({
      name,
      visibility,
      syncToKobo: showKobo ? syncToKobo : null,
      smart: smart ? { matchMode, drafts } : null,
    });
    if ("error" in result) {
      setInvalid(result.error);
      return;
    }
    setInvalid(null);
    save.mutate(result.request);
  };

  return (
    <ConfirmModal
      testId="edit-shelf-modal"
      ariaLabel="Edit shelf"
      backdropClass="shelf-modal-overlay"
      dialogClass="shelf-modal-card"
      busy={save.isPending}
      onDismiss={onClose}
    >
      <div className="shelf-modal-head">
        <input
          type="text"
          className="shelf-name-input"
          placeholder="Shelf name…"
          aria-label="Shelf name"
          data-testid="edit-shelf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="shelf-badge">{kindLabel(shelf.kind)}</span>
        <VisibilityToggle visibility={visibility} onChange={setVisibility} />
      </div>
      {smart && (
        <div className="shelf-modal-body">
          <RuleBuilder
            matchMode={matchMode}
            drafts={drafts}
            onMatchMode={setMatchMode}
            onDrafts={setDrafts}
          />
        </div>
      )}
      {showKobo && (
        <div className="shelf-modal-kobo">
          <span className="shelf-kobo-label">Sync to Kobo</span>
          <div className="shelf-kobo-toggle">
            {KOBO.map(([on, label, testid]) => (
              <button
                key={label}
                type="button"
                className="shelf-toggle-btn"
                aria-pressed={syncToKobo === on}
                data-testid={testid}
                onClick={() => setSyncToKobo(on)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="shelf-modal-error"
          data-testid="edit-shelf-error"
        >
          {error}
        </p>
      )}
      <div className="shelf-modal-foot">
        <Button
          className="shelf-btn-ghost"
          disabled={save.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className="shelf-btn-primary"
          data-testid="edit-shelf-save"
          disabled={save.isPending}
          aria-busy={save.isPending}
          onClick={submit}
        >
          <BusyLabel busy={save.isPending} label="Save" busyLabel="Saving…" />
        </Button>
      </div>
    </ConfirmModal>
  );
}

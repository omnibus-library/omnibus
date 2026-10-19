import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { type Book, createShelf, type ShelfDetail } from "../../api";
import type { MatchMode } from "../../api/generated/schemas";
import { Button } from "../Button/Button";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { LibraryPicker } from "../LibraryPicker/LibraryPicker";
import { BusyLabel } from "../Loading/Loading";
import { RuleBuilder } from "./RuleBuilder";
import { BLANK_DRAFT, createRequest, type RuleDraft } from "./rules";
import { VisibilityToggle } from "./VisibilityToggle";
import "../ShelfPicker/ShelfPicker.css";
import "./ShelfForm.css";

const NO_BOOKS: ReadonlySet<string> = new Set();

const KINDS = [
  ["smart", "Smart", "shelf-kind-smart"],
  ["manual", "Hand-picked", "shelf-kind-manual"],
] as const;

/** The form that makes a shelf: smart (rules, with a live preview) or hand-picked (books chosen from the library). */
export function CreateShelfModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (shelf: ShelfDetail) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"smart" | "manual">("smart");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [matchMode, setMatchMode] = useState<MatchMode>("all");
  const [drafts, setDrafts] = useState<RuleDraft[]>([BLANK_DRAFT]);
  const [picked, setPicked] = useState<Book[]>([]);
  const create = useMutation({
    mutationFn: createShelf,
    onSuccess: onCreated,
  });

  return (
    <ConfirmModal
      testId="create-shelf-modal"
      ariaLabel="New shelf"
      backdropClass="shelf-modal-overlay"
      dialogClass="shelf-modal-card"
      busy={create.isPending}
      onDismiss={onClose}
    >
      <div className="shelf-modal-head">
        <input
          type="text"
          className="shelf-name-input"
          placeholder="Shelf name…"
          aria-label="Shelf name"
          data-testid="shelf-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="shelf-kind-toggle">
          {KINDS.map(([value, label, testid]) => (
            <button
              key={value}
              type="button"
              className="shelf-toggle-btn"
              aria-pressed={kind === value}
              data-testid={testid}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <VisibilityToggle visibility={visibility} onChange={setVisibility} />
      </div>
      <div className="shelf-modal-body">
        {kind === "smart" ? (
          <RuleBuilder
            matchMode={matchMode}
            drafts={drafts}
            onMatchMode={setMatchMode}
            onDrafts={setDrafts}
          />
        ) : (
          <LibraryPicker
            picked={picked}
            onPicked={setPicked}
            already={NO_BOOKS}
            searchTestId="shelf-picker-search"
          />
        )}
      </div>
      {create.isError && (
        <p
          role="alert"
          className="shelf-modal-error"
          data-testid="shelf-create-error"
        >
          {create.error.message}
        </p>
      )}
      <div className="shelf-modal-foot">
        <Button
          className="shelf-btn-ghost"
          disabled={create.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className="shelf-btn-primary"
          data-testid="shelf-create-submit"
          disabled={create.isPending}
          aria-busy={create.isPending}
          onClick={() =>
            create.mutate(
              createRequest(
                kind === "smart"
                  ? { kind, name, visibility, matchMode, drafts }
                  : { kind, name, visibility, picked },
              ),
            )
          }
        >
          <BusyLabel
            busy={create.isPending}
            label={kind === "smart" ? "Create" : `Create · ${picked.length}`}
            busyLabel="Creating…"
          />
        </Button>
      </div>
    </ConfirmModal>
  );
}

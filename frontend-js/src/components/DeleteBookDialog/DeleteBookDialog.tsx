import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  type BookUuid,
  type DeletionManifest,
  deleteBookFiles,
  fetchDeletionManifest,
} from "../../api";
import { fileSize } from "../../format";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { BusyLabel, Loading } from "../Loading/Loading";
import { chooseLabels, confirmLabels, itemCount } from "./deleteLabels";

type Picks = Set<number>;

function Row({
  id,
  testId,
  badge,
  label,
  meta,
  picked,
  onToggle,
}: {
  id: number;
  testId: string;
  badge: string;
  label: string;
  meta: string;
  picked: Picks;
  onToggle: (id: number, on: boolean) => void;
}) {
  const on = picked.has(id);
  return (
    <li className={on ? "del-item is-picked" : "del-item"}>
      <label className="del-item-label">
        <input
          className="del-check"
          type="checkbox"
          data-testid={testId}
          checked={on}
          onChange={(event) => onToggle(id, event.target.checked)}
        />
        <div className="del-item-copy">
          <div className="del-item-head">
            <span className="mono del-badge">{badge}</span>
            <span className="del-item-title">{label}</span>
          </div>
          <div className="mono del-item-meta">{meta}</div>
        </div>
      </label>
    </li>
  );
}

function Actions({
  busy,
  onClose,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="del-actions">
      <button
        type="button"
        className="del-btn-ghost"
        data-testid="delete-cancel"
        disabled={busy}
        onClick={onClose}
      >
        Cancel
      </button>
      {children}
    </div>
  );
}

const withToggled = (set: Picks, id: number, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

type DialogProps = {
  uuid: BookUuid;
  title: string;
  /** Called with whether the book itself went, once the delete has landed. */
  onDeleted: (bookDeleted: boolean) => void;
  onClose: () => void;
};

/** Choose which files and physical copies to delete, then confirm; deleting the last of them deletes the book. */
export function DeleteBookDialog({
  uuid,
  title,
  onDeleted,
  onClose,
}: DialogProps) {
  const [stage, setStage] = useState<"choose" | "confirm">("choose");
  const [files, setFiles] = useState<Picks>(new Set());
  const [copies, setCopies] = useState<Picks>(new Set());
  // Read fresh each time the dialog opens; a stale list could delete the wrong thing.
  const manifest = useQuery({
    queryKey: ["book", uuid, "deletionManifest"],
    queryFn: () => fetchDeletionManifest(uuid),
    gcTime: 0,
  });
  const remove = useMutation({
    mutationFn: () => deleteBookFiles(uuid, [...files], [...copies]),
    onSuccess: ({ bookDeleted }) => onDeleted(bookDeleted),
  });
  const busy = remove.isPending;
  const error = remove.error ?? manifest.error;

  const ready = manifest.data;
  let pane: ReactNode;
  if (!ready) {
    pane = (
      <div className="del-body">
        <h2 className="del-title">Delete files…</h2>
        {/* A failed fetch has stopped working, so it says so instead. */}
        {error ? (
          <p role="alert" className="bd-merge-error">
            {error.message}
          </p>
        ) : (
          <Loading kind="sheet" label="Loading this book’s files…" />
        )}
        <Actions busy={busy} onClose={onClose} />
      </div>
    );
  } else if (stage === "confirm" || itemCount(ready) === 0) {
    pane = (
      <Confirm
        title={title}
        manifest={ready}
        picked={{ files, copies }}
        busy={busy}
        error={error?.message ?? null}
        onBack={() => setStage("choose")}
        onConfirm={() => remove.mutate()}
        onClose={onClose}
      />
    );
  } else {
    pane = (
      <Choose
        title={title}
        manifest={ready}
        picked={{ files, copies }}
        onFiles={(id, on) => setFiles(withToggled(files, id, on))}
        onCopies={(id, on) => setCopies(withToggled(copies, id, on))}
        onAll={(all) => {
          setFiles(all ? new Set(ready.files.map((f) => f.id)) : new Set());
          setCopies(all ? new Set(ready.copies.map((c) => c.id)) : new Set());
        }}
        onContinue={() => setStage("confirm")}
        onClose={onClose}
      />
    );
  }
  return (
    // No dismissal mid-delete: closing would hide the outcome while the request runs.
    <ConfirmModal
      testId="delete-book-dialog"
      ariaLabel="Delete book files"
      dialogClass="mg-modal del-modal"
      busy={busy}
      onDismiss={onClose}
    >
      {pane}
    </ConfirmModal>
  );
}

type ChooseProps = {
  title: string;
  manifest: DeletionManifest;
  picked: { files: Picks; copies: Picks };
  onFiles: (id: number, on: boolean) => void;
  onCopies: (id: number, on: boolean) => void;
  onAll: (all: boolean) => void;
  onContinue: () => void;
  onClose: () => void;
};

function Choose({
  title,
  manifest,
  picked,
  onFiles,
  onCopies,
  onAll,
  onContinue,
  onClose,
}: ChooseProps) {
  const count = picked.files.size + picked.copies.size;
  const labels = chooseLabels(manifest, count);
  return (
    <div className="del-body">
      <h2 className="del-title">Delete files from “{title}”?</h2>
      <p className="del-copy">{labels.intro}</p>
      <div className="del-section-head">
        <span className="label del-section-label">{labels.filesHead}</span>
        <button
          type="button"
          className="del-select-all"
          data-testid="delete-select-all"
          onClick={() => onAll(!labels.allPicked)}
        >
          {labels.allPicked ? "Clear selection" : "Select all"}
        </button>
      </div>
      <ul className="del-items">
        {manifest.files.map((file) => (
          <Row
            key={file.id}
            id={file.id}
            testId={`delete-file-${file.id}`}
            badge={file.format.toUpperCase()}
            label={file.label?.trim() ? file.label : file.filename}
            meta={
              [fileSize(file.sizeBytes), file.path]
                .filter(Boolean)
                .join(" · ") || file.filename
            }
            picked={picked.files}
            onToggle={onFiles}
          />
        ))}
      </ul>
      {manifest.copies.length > 0 && (
        <>
          <div className="del-section-head">
            <span className="label del-section-label">PHYSICAL COPIES</span>
          </div>
          <ul className="del-items">
            {manifest.copies.map((copy) => (
              <Row
                key={copy.id}
                id={copy.id}
                testId={`delete-copy-${copy.id}`}
                badge="OWN"
                label={copy.note?.trim() ? copy.note : "Physical copy"}
                // A copy has no file: removing it un-records it rather than touching disk.
                meta={
                  copy.isbn
                    ? `ISBN ${copy.isbn} · no file on disk`
                    : "no file on disk"
                }
                picked={picked.copies}
                onToggle={onCopies}
              />
            ))}
          </ul>
          <p className="mono del-note">
            Book record is removed only when every item here is selected.
          </p>
        </>
      )}
      <Actions busy={false} onClose={onClose}>
        <button
          type="button"
          className="del-btn-danger"
          data-testid="delete-continue"
          disabled={count === 0}
          onClick={onContinue}
        >
          {labels.action}
        </button>
      </Actions>
    </div>
  );
}

type ConfirmProps = {
  title: string;
  manifest: DeletionManifest;
  picked: { files: Picks; copies: Picks };
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
  onClose: () => void;
};

function Confirm({
  title,
  manifest,
  picked,
  busy,
  error,
  onBack,
  onConfirm,
  onClose,
}: ConfirmProps) {
  const labels = confirmLabels(title, manifest, picked);
  return (
    <div className="del-body">
      <h2 className="del-title">{labels.heading}</h2>
      <p className="del-copy" data-testid="delete-confirm-copy">
        {labels.copy}
      </p>
      {labels.losses.length > 0 && (
        <p className="del-copy del-losses" data-testid="delete-losses">
          Also deleted: {labels.losses.join(", ")}.
        </p>
      )}
      {error && (
        <p role="alert" className="bd-merge-error">
          {error}
        </p>
      )}
      <Actions busy={busy} onClose={onClose}>
        {!labels.empty && (
          <button
            type="button"
            className="del-btn-ghost"
            data-testid="delete-back"
            disabled={busy}
            onClick={onBack}
          >
            Back
          </button>
        )}
        <button
          type="button"
          className="del-btn-danger"
          data-testid="delete-confirm"
          disabled={busy}
          aria-busy={busy}
          onClick={onConfirm}
        >
          <BusyLabel busy={busy} label={labels.action} busyLabel="Deleting…" />
        </button>
      </Actions>
    </div>
  );
}

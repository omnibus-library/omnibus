import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { addShelfBooks, type Book } from "../../api";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { LibraryPicker } from "../LibraryPicker/LibraryPicker";
import { ModalFoot } from "../ShelfForm/ModalFoot";
import "../ShelfPicker/ShelfPicker.css";

type AddBooksModalProps = {
  shelfId: number;
  shelfName: string;
  /** The uuids the shelf already holds. */
  members: readonly string[];
  onClose: () => void;
  onAdded: () => void;
};

/** Search the library, pick books and append them to a hand-picked shelf; a failure keeps the picks and says why. */
export function AddBooksModal({
  shelfId,
  shelfName,
  members,
  onClose,
  onAdded,
}: AddBooksModalProps) {
  const [picked, setPicked] = useState<Book[]>([]);
  const already = useMemo(() => new Set(members), [members]);
  const add = useMutation({
    mutationFn: () =>
      addShelfBooks(
        shelfId,
        picked.map((b) => b.uuid),
      ),
    onSuccess: onAdded,
  });
  const count = picked.length;
  const label =
    count === 0
      ? "Add books"
      : count === 1
        ? "Add 1 book"
        : `Add ${count} books`;

  return (
    <ConfirmModal
      testId="add-books-modal"
      labelledBy="add-books-title"
      backdropClass="shelf-modal-overlay"
      dialogClass="shelf-modal-card"
      busy={add.isPending}
      onDismiss={onClose}
    >
      <div className="pick-head">
        <div>
          <span className="pick-kicker">Adding to</span>
          <h2 className="pick-title" id="add-books-title">
            {shelfName}
          </h2>
        </div>
        <button
          type="button"
          className="pick-close"
          aria-label="Close"
          data-testid="add-books-close"
          disabled={add.isPending}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <LibraryPicker
        picked={picked}
        onPicked={setPicked}
        already={already}
        searchTestId="add-books-search"
        autoFocus
      />
      {add.isError && (
        <p
          role="alert"
          className="shelf-modal-error"
          data-testid="add-books-error"
        >
          {`Couldn’t add these books: ${add.error.message}`}
        </p>
      )}
      <ModalFoot
        className="pick-foot"
        busy={add.isPending}
        onCancel={onClose}
        cancelTestId="add-books-cancel"
        submit={{
          label,
          busyLabel: "Adding…",
          testId: "add-books-submit",
          disabled: count === 0,
          onClick: () => add.mutate(),
        }}
      />
    </ConfirmModal>
  );
}

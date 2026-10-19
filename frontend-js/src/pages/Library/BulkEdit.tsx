import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  addShelfBooks,
  type Book,
  bulkSaveOverrides,
  nameCountsQuery,
  shelvesQuery,
  thumbUrl,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ChipInput } from "../../components/ChipInput/ChipInput";
import { attributedOwner } from "../../components/FilterBar/filters";
import { BusyLabel, Loading, Ring } from "../../components/Loading/Loading";
import { trapTab } from "../../focusTrap";
import { bookCount } from "../../format";
import { useCurrentUser } from "../../session";
import {
  type BulkEdit,
  bulkWire,
  isEmptyEdit,
  NO_EDIT,
  removable,
} from "./bulkEdit";
import { addTargets } from "./shelfGallery";

/** Where focus lands when the opener is gone: the select-all checkbox, as a saved edit drops the selection. */
type FallbackFocus = RefObject<HTMLElement | null>;

type ModalProps = {
  label: string;
  busy: boolean;
  backdropClass: string;
  dialogClass: string;
  fallbackFocus: FallbackFocus;
  onClose: () => void;
  children: ReactNode;
};

/** A dialog over a backdrop: Escape and a backdrop click close it unless busy, Tab stays inside, focus returns on close. */
function Modal({
  label,
  busy,
  backdropClass,
  dialogClass,
  fallbackFocus,
  onClose,
  children,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      // A saved edit drops the selection and its bar, the opener with them; the table is the next stop.
      const target =
        opener instanceof HTMLElement && opener.isConnected
          ? opener
          : fallbackFocus.current;
      target?.focus();
    };
  }, [fallbackFocus]);
  const dismiss = () => {
    if (!busy) onClose();
  };
  return (
    <div
      ref={dialog}
      className={backdropClass}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // A drag that began in the card and ended on the backdrop is not a dismissal.
        if (pressedBackdrop.current && e.target === e.currentTarget) dismiss();
        pressedBackdrop.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          dismiss();
        }
        trapTab(e, e.currentTarget);
      }}
    >
      <div className={dialogClass}>{children}</div>
    </div>
  );
}

type BarProps = {
  count: number;
  onEdit: () => void;
  onAddToShelf: () => void;
  onClear: () => void;
};

/** The floating bar shown while table rows are checked. */
export function BulkEditBar({
  count,
  onEdit,
  onAddToShelf,
  onClear,
}: BarProps) {
  return (
    <div className="bulk-edit-bar">
      <span className="bulk-edit-count">{bookCount(count)} selected</span>
      <Button className="shelf-btn-primary" onClick={onEdit}>
        Edit
      </Button>
      <Button className="shelf-btn-ghost" onClick={onAddToShelf}>
        Add to shelf
      </Button>
      <Button className="shelf-btn-ghost" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}

const TEXT_FIELDS = [
  { key: "series", label: "Series", placeholder: "Series name" },
  { key: "publisher", label: "Publisher", placeholder: "Publisher" },
  { key: "language", label: "Language", placeholder: "en" },
] as const;

const CHIP_FIELDS = [
  {
    key: "addTags",
    label: "Add tags",
    placeholder: "Add a tag to every book…",
    removeLabel: "Remove tag",
  },
  {
    key: "removeTags",
    label: "Remove tags",
    placeholder: "Remove a tag where present…",
    removeLabel: "Remove tag",
  },
  {
    key: "addGenres",
    label: "Add genres",
    placeholder: "Add a genre to every book…",
    removeLabel: "Remove genre",
  },
  {
    key: "removeGenres",
    label: "Remove genres",
    placeholder: "Remove a genre where present…",
    removeLabel: "Remove genre",
  },
] as const;

type ModalBodyProps = {
  books: Book[];
  fallbackFocus: FallbackFocus;
  onClose: () => void;
  /** The edit is saved; the caller closes the modal and drops the selection. */
  onSaved: () => void;
};

/** The bulk edit dialog: one `edit` applied to every selected book in a single request. */
export function BulkEditModal({
  books,
  fallbackFocus,
  onClose,
  onSaved,
}: ModalBodyProps) {
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState<BulkEdit>(NO_EDIT);
  const set = <K extends keyof BulkEdit>(key: K, value: BulkEdit[K]) =>
    setEdit((prev) => ({ ...prev, [key]: value }));
  // A suggestion pool is a convenience: while it loads, or if it fails, the field takes free text.
  const pools = {
    authors: useQuery(nameCountsQuery("author")).data ?? [],
    addTags: useQuery(nameCountsQuery("tag")).data ?? [],
    addGenres: useQuery(nameCountsQuery("genre")).data ?? [],
    removeTags: removable(books, "subjects"),
    removeGenres: removable(books, "genres"),
  };

  const apply = useMutation({
    mutationFn: async () => {
      try {
        await bulkSaveOverrides(
          books.map((book) => book.uuid),
          bulkWire(edit),
        );
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(`Save failed: ${reason}`);
      }
    },
    // Only a save that landed changes anything: a refused one is all-or-nothing, and
    // refetching on failure would hold the dialog on "Applying…" until every page answers.
    // A tag edit can move books between smart shelves and change the resume row too.
    onSuccess: () => {
      for (const queryKey of [
        ["books"],
        ["shelf-page"],
        ["shelves"],
        ["progress", "recent"],
      ]) {
        queryClient.invalidateQueries({ queryKey });
      }
      onSaved();
    },
  });

  const count = bookCount(books.length);
  return (
    <Modal
      label={`Bulk edit ${count}`}
      busy={apply.isPending}
      backdropClass="author-photo-modal-backdrop"
      dialogClass="bulk-edit-dialog"
      fallbackFocus={fallbackFocus}
      onClose={onClose}
    >
      <h3 className="bulk-edit-title">Edit {count}</h3>
      <p className="bulk-edit-hint">
        Blank fields are left unchanged on every book.
      </p>
      <div className="bulk-edit-fields">
        <div className="bulk-edit-field">
          <span className="bulk-edit-label">Authors</span>
          <ChipInput
            label="Authors"
            values={edit.authors}
            onChange={(next) => set("authors", next)}
            suggestions={pools.authors}
            placeholder="Replace authors…"
            removeLabel="Remove"
            inputClass="me-chip-input"
          />
        </div>
        {TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className="bulk-edit-field">
            <label className="bulk-edit-label" htmlFor={`bulk-${key}`}>
              {label}
            </label>
            <input
              id={`bulk-${key}`}
              className="bulk-edit-input"
              type="text"
              placeholder={placeholder}
              value={edit[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        ))}
        {CHIP_FIELDS.map(({ key, label, placeholder, removeLabel }) => (
          <div key={key} className="bulk-edit-field">
            <span className="bulk-edit-label">{label}</span>
            <ChipInput
              label={label}
              values={edit[key]}
              onChange={(next) => set(key, next)}
              suggestions={pools[key]}
              placeholder={placeholder}
              removeLabel={removeLabel}
            />
          </div>
        ))}
      </div>
      {apply.isError && (
        <p className="bulk-edit-error" role="alert">
          {apply.error.message}
        </p>
      )}
      <div className="shelf-modal-foot">
        <Button
          className="shelf-btn-ghost"
          disabled={apply.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className="shelf-btn-primary"
          disabled={apply.isPending || isEmptyEdit(edit)}
          aria-busy={apply.isPending}
          onClick={() => apply.mutate()}
        >
          <BusyLabel
            busy={apply.isPending}
            label={`Apply to ${count}`}
            busyLabel="Applying…"
          />
        </Button>
      </div>
    </Modal>
  );
}

type PickerProps = {
  books: Book[];
  fallbackFocus: FallbackFocus;
  onClose: () => void;
  /** The books are on the shelf; the caller closes the picker and drops the selection. */
  onAdded: () => void;
};

/** Files every selected book on one hand-picked shelf, picked from the shelves the reader may change. */
export function BulkShelfPicker({
  books,
  fallbackFocus,
  onClose,
  onAdded,
}: PickerProps) {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const shelves = useQuery(shelvesQuery);
  const add = useMutation({
    mutationFn: async (shelf: { id: number; name: string }) => {
      try {
        await addShelfBooks(
          shelf.id,
          books.map((book) => book.uuid),
        );
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(`Couldn't add to ${shelf.name}: ${reason}`);
      }
    },
    onSuccess: () => {
      for (const queryKey of [["shelves"], ["shelf-page"], ["books"]]) {
        queryClient.invalidateQueries({ queryKey });
      }
      onAdded();
    },
  });
  const writing = add.isPending ? add.variables.id : null;

  const targets = shelves.data && addTargets(shelves.data, user);
  const count = bookCount(books.length);
  return (
    <Modal
      label={`Add ${count} to a shelf`}
      busy={add.isPending}
      backdropClass="shelf-modal-overlay"
      dialogClass="shelf-modal-card shelf-picker-card"
      fallbackFocus={fallbackFocus}
      onClose={onClose}
    >
      <div className="pick-head">
        <div>
          <span className="pick-kicker">Hand-picked shelves</span>
          <h2 className="pick-title">Add {count} to a shelf</h2>
        </div>
        <button
          type="button"
          className="pick-close"
          aria-label="Close"
          // aria-disabled, not disabled: a control that disables itself drops the keyboard's focus.
          aria-disabled={add.isPending}
          onClick={add.isPending ? undefined : onClose}
        >
          ✕
        </button>
      </div>
      <p className="shelf-picker-hint">
        Only shelves you fill by hand are listed; smart shelves add books by
        their rules.
      </p>
      {targets === undefined &&
        (shelves.isError ? (
          <p className="pick-state">
            Your shelves didn’t load. Close this and try again.
          </p>
        ) : (
          <Loading kind="sheet" label="Gathering your shelves" />
        ))}
      {targets?.length === 0 && (
        <div className="pick-state">
          <p>You have no hand-picked shelves yet.</p>
          <p>
            Make one on the <Link to="/shelves">shelves page →</Link>
          </p>
        </div>
      )}
      {targets && targets.length > 0 && (
        <div className="shelf-picker-list">
          <div className="pick-grid">
            {targets.map((shelf) => {
              const cover = shelf.coverUuids[0];
              const owner = attributedOwner(shelf, user.id);
              return (
                <button
                  key={shelf.id}
                  type="button"
                  className="pick-card"
                  aria-busy={writing === shelf.id}
                  aria-disabled={add.isPending && writing !== shelf.id}
                  onClick={add.isPending ? undefined : () => add.mutate(shelf)}
                >
                  {cover ? (
                    <img
                      className="pick-cover"
                      src={thumbUrl(cover, "sm")}
                      alt=""
                    />
                  ) : (
                    <span className="pick-cover" aria-hidden="true" />
                  )}
                  <span className="pick-meta">
                    <span className="pick-name">{shelf.name}</span>
                    <span className="pick-author">
                      {bookCount(shelf.bookCount)}
                      {owner && ` · ${owner}`}
                    </span>
                  </span>
                  <span className="pick-check" aria-hidden="true">
                    {writing === shelf.id && <Ring size="xs" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {add.isError && (
        <p className="shelf-modal-error" role="alert">
          {add.error.message}
        </p>
      )}
    </Modal>
  );
}

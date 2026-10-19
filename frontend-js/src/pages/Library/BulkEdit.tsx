import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type Book,
  fetchAuthorOptions,
  fetchGenreOptions,
  fetchTagOptions,
  type NamedCount,
  saveOverrides,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ChipInput } from "../../components/ChipInput/ChipInput";
import { BusyLabel } from "../../components/Loading/Loading";
import { trapTab } from "../../focusTrap";
import { plural } from "../../format";
import {
  type BulkEdit,
  isEmptyEdit,
  NO_EDIT,
  overridesFor,
  removable,
} from "./bulkEdit";

type ModalProps = {
  label: string;
  busy: boolean;
  backdropClass: string;
  dialogClass: string;
  onClose: () => void;
  children: ReactNode;
};

/** A dialog over a backdrop: Escape and a backdrop click close it unless busy, Tab stays inside, focus returns on close. */
function Modal({
  label,
  busy,
  backdropClass,
  dialogClass,
  onClose,
  children,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
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
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          dismiss();
        }
        trapTab(e, e.currentTarget);
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: only keeps a click inside the card from reaching the backdrop */}
      <div className={dialogClass} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

type BarProps = {
  count: number;
  onEdit: () => void;
  onClear: () => void;
};

/** The floating bar shown while table rows are checked. */
export function BulkEditBar({ count, onEdit, onClear }: BarProps) {
  return (
    <div className="bulk-edit-bar">
      <span className="bulk-edit-count">
        {count} book{plural(count)} selected
      </span>
      <Button className="shelf-btn-primary" onClick={onEdit}>
        Edit
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

// A suggestion pool is a convenience: while it loads, or if it fails, the field takes free text.
function usePool(key: string, fetcher: () => Promise<NamedCount[]>) {
  return (
    useQuery({ queryKey: ["name-counts", key], queryFn: fetcher }).data ?? []
  );
}

type ModalBodyProps = {
  books: Book[];
  onClose: () => void;
  /** Every book is saved; the caller closes the modal and drops the selection. */
  onSaved: () => void;
};

/** The bulk edit dialog: one `edit` applied to each selected book in turn. */
export function BulkEditModal({ books, onClose, onSaved }: ModalBodyProps) {
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState<BulkEdit>(NO_EDIT);
  const set = <K extends keyof BulkEdit>(key: K, value: BulkEdit[K]) =>
    setEdit((prev) => ({ ...prev, [key]: value }));
  const pools = {
    authors: usePool("author", fetchAuthorOptions),
    addTags: usePool("tag", fetchTagOptions),
    addGenres: usePool("genre", fetchGenreOptions),
    removeTags: removable(books, "subjects"),
    removeGenres: removable(books, "genres"),
  };

  const apply = useMutation({
    mutationFn: async () => {
      for (const [saved, book] of books.entries()) {
        try {
          await saveOverrides(book.uuid, overridesFor(book, edit));
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          const done = saved
            ? ` (${saved} of ${books.length} books saved)`
            : "";
          throw new Error(`Save failed: ${reason}${done}`);
        }
      }
    },
    // A partial save still changed the lists, so they refetch either way.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["books"] }),
        queryClient.invalidateQueries({ queryKey: ["shelf-page"] }),
      ]),
    onSuccess: onSaved,
  });

  const count = `${books.length} book${plural(books.length)}`;
  return (
    <Modal
      label={`Bulk edit ${count}`}
      busy={apply.isPending}
      backdropClass="author-photo-modal-backdrop"
      dialogClass="bulk-edit-dialog"
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

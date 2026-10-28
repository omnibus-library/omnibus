import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { nameCountsQuery } from "../../api";
import { ChipInput } from "../../components/ChipInput/ChipInput";

// Spelled out whole, so the Atrium extractor finds each class.
const TEXT_CELLS = {
  title: {
    plain: "ebook-col-title",
    idle: "ebook-col-title ebook-cell-editable",
    open: "ebook-col-title ebook-cell-editable ebook-cell-editing",
    label: "Title",
    placeholder: undefined,
    spellCheck: undefined,
  },
  series: {
    plain: "ebook-col-series",
    idle: "ebook-col-series ebook-cell-editable",
    open: "ebook-col-series ebook-cell-editable ebook-cell-editing",
    label: "Series",
    placeholder: undefined,
    spellCheck: undefined,
  },
  published: {
    plain: "ebook-col-published",
    idle: "ebook-col-published ebook-cell-editable",
    open: "ebook-col-published ebook-cell-editable ebook-cell-editing",
    label: "Published",
    placeholder: "YYYY-MM-DD",
    spellCheck: false,
  },
  language: {
    plain: "ebook-col-language",
    idle: "ebook-col-language ebook-cell-editable",
    open: "ebook-col-language ebook-cell-editable ebook-cell-editing",
    label: "Language",
    placeholder: "en",
    spellCheck: false,
  },
} as const;

export type TextField = keyof typeof TEXT_CELLS;

/** The input of an open text cell; it settles once, however the browser orders Enter and blur. */
function TextEditor({
  label,
  placeholder,
  spellCheck,
  initial,
  settle,
}: {
  label: string;
  placeholder: string | undefined;
  spellCheck: boolean | undefined;
  initial: string;
  /** `value` is the trimmed text to save, or `null` when it is dropped or unchanged. */
  settle: (value: string | null, refocus: boolean) => void;
}) {
  // What the cell held when it opened: a refetch while it is open does not move the baseline.
  const [opened] = useState(initial);
  const [draft, setDraft] = useState(opened);
  const settled = useRef(false);
  const finish = (save: boolean, refocus: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = draft.trim();
    settle(save && next !== opened.trim() ? next : null, refocus);
  };
  return (
    <input
      className="ebook-cell-edit"
      // biome-ignore lint/a11y/noAutofocus: the editor opens on the user's own click
      autoFocus
      aria-label={label}
      placeholder={placeholder}
      spellCheck={spellCheck}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === "Escape") {
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
    />
  );
}

/** Where the cell's button gets focus back once its editor has closed. */
function useRefocus(open: boolean) {
  const button = useRef<HTMLButtonElement>(null);
  const wanted = useRef(false);
  useEffect(() => {
    if (open || !wanted.current) return;
    wanted.current = false;
    button.current?.focus();
  }, [open]);
  const refocus = () => {
    wanted.current = true;
  };
  return { button, refocus };
}

/** A title, series, published or language cell: a button until clicked, then an input that saves on Enter or blur. */
export function TextCell({
  field,
  bookTitle,
  display,
  initial,
  editable,
  open,
  onOpen,
  onClose,
  onSave,
}: {
  field: TextField;
  /** The row's book, which names the edit button among the rows. */
  bookTitle: string;
  /** What the cell reads when closed. */
  display: string;
  /** The raw value the input starts from, which is not always what is displayed. */
  initial: string;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const cell = TEXT_CELLS[field];
  const { button, refocus } = useRefocus(open);
  if (!editable) {
    return (
      <td className={cell.plain}>
        <div className="ebook-title-cell">{display}</div>
      </td>
    );
  }
  const settle = (value: string | null, focusButton: boolean) => {
    // A blank title is a cancel: the book keeps the one it has.
    if (value !== null && (value !== "" || field !== "title")) onSave(value);
    if (focusButton) refocus();
    onClose();
  };
  return (
    <td className={open ? cell.open : cell.idle}>
      {open ? (
        <TextEditor
          label={cell.label}
          placeholder={cell.placeholder}
          spellCheck={cell.spellCheck}
          initial={initial}
          settle={settle}
        />
      ) : (
        <button
          ref={button}
          type="button"
          className="ebook-cell-edit-btn"
          aria-label={`Edit ${field} of ${bookTitle}: ${initial.trim() ? display : "none"}`}
          onClick={onOpen}
        >
          <span className="ebook-title-cell">{display}</span>
        </button>
      )}
    </td>
  );
}

const CHIP_CELLS = {
  authors: {
    plain: "ebook-col-author",
    idle: "ebook-col-author ebook-cell-editable",
    open: "ebook-col-author ebook-cell-editable ebook-cell-editing",
    kind: "author",
    label: "Authors",
    placeholder: "+ add author…",
    removeLabel: "Remove",
    inputClass: "me-chip-input",
  },
  tags: {
    plain: "ebook-col-tags",
    idle: "ebook-col-tags ebook-cell-editable",
    open: "ebook-col-tags ebook-cell-editable ebook-cell-editing",
    kind: "tag",
    label: "Tags",
    placeholder: "+ add tag…",
    removeLabel: "Remove tag",
    inputClass: "me-tag-input",
  },
  genres: {
    plain: "ebook-col-genres",
    idle: "ebook-col-genres ebook-cell-editable",
    open: "ebook-col-genres ebook-cell-editable ebook-cell-editing",
    kind: "genre",
    label: "Genres",
    placeholder: "+ add genre…",
    removeLabel: "Remove genre",
    inputClass: "me-tag-input",
  },
} as const;

export type ChipField = keyof typeof CHIP_CELLS;

/** The open chip cell: every add or remove is saved at once, and Escape or focus leaving closes it. */
function ChipEditor({
  field,
  values,
  onChange,
  close,
}: {
  field: ChipField;
  values: string[];
  onChange: (values: string[]) => void;
  close: (refocus: boolean) => void;
}) {
  const cell = CHIP_CELLS[field];
  const pool = useQuery(nameCountsQuery(cell.kind));
  return (
    <fieldset
      className="ebook-cell-chip-host"
      aria-label={`Edit ${field}`}
      // Focus stays in the input unless the click is on it: a label, the gap or a ✕ in Safari would blur it and close the editor.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) close(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close(false);
      }}
    >
      <ChipInput
        autoFocus
        label={cell.label}
        values={values}
        onChange={onChange}
        suggestions={pool.data ?? []}
        placeholder={cell.placeholder}
        removeLabel={cell.removeLabel}
        inputClass={cell.inputClass}
      />
    </fieldset>
  );
}

/** An authors, tags or genres cell: a button until clicked, then a chip editor. */
export function ChipCell({
  field,
  bookTitle,
  values,
  editable,
  open,
  onOpen,
  onClose,
  onChange,
}: {
  field: ChipField;
  /** The row's book, which names the edit button among the rows. */
  bookTitle: string;
  values: string[];
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (values: string[]) => void;
}) {
  const cell = CHIP_CELLS[field];
  const { button, refocus } = useRefocus(open);
  const display = values.join(", ");
  if (!editable) {
    return (
      <td className={cell.plain}>
        <div className="ebook-title-cell">{display}</div>
      </td>
    );
  }
  return (
    <td className={open ? cell.open : cell.idle}>
      {open ? (
        <ChipEditor
          field={field}
          values={values}
          onChange={onChange}
          close={(focusButton) => {
            if (focusButton) refocus();
            onClose();
          }}
        />
      ) : (
        <button
          ref={button}
          type="button"
          className="ebook-cell-edit-btn"
          aria-label={`Edit ${field} of ${bookTitle}: ${display || "none"}`}
          onClick={onOpen}
        >
          <span className="ebook-title-cell">{display}</span>
        </button>
      )}
    </td>
  );
}

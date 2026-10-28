import { useEffect, useRef, useState } from "react";

// Spelled out whole, so the Atrium extractor finds each class.
const TEXT_CELLS = {
  title: {
    plain: "ebook-col-title",
    idle: "ebook-col-title ebook-cell-editable",
    open: "ebook-col-title ebook-cell-editable ebook-cell-editing",
    label: "Title",
    placeholder: undefined,
  },
  series: {
    plain: "ebook-col-series",
    idle: "ebook-col-series ebook-cell-editable",
    open: "ebook-col-series ebook-cell-editable ebook-cell-editing",
    label: "Series",
    placeholder: undefined,
  },
  published: {
    plain: "ebook-col-published",
    idle: "ebook-col-published ebook-cell-editable",
    open: "ebook-col-published ebook-cell-editable ebook-cell-editing",
    label: "Published",
    placeholder: "YYYY-MM-DD",
  },
  language: {
    plain: "ebook-col-language",
    idle: "ebook-col-language ebook-cell-editable",
    open: "ebook-col-language ebook-cell-editable ebook-cell-editing",
    label: "Language",
    placeholder: "en",
  },
} as const;

export type TextField = keyof typeof TEXT_CELLS;

/** The input of an open text cell; it settles once, however the browser orders Enter and blur. */
function TextEditor({
  label,
  placeholder,
  initial,
  settle,
}: {
  label: string;
  placeholder: string | undefined;
  initial: string;
  /** `value` is the trimmed text to save, or `null` to drop it. */
  settle: (value: string | null, refocus: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const settled = useRef(false);
  const finish = (save: boolean, refocus: boolean) => {
    if (settled.current) return;
    settled.current = true;
    settle(save ? draft.trim() : null, refocus);
  };
  return (
    <input
      className="ebook-cell-edit"
      // biome-ignore lint/a11y/noAutofocus: the editor opens on the user's own click
      autoFocus
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
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
  display,
  initial,
  editable,
  open,
  onOpen,
  onClose,
  onSave,
}: {
  field: TextField;
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
    if (value !== null && value !== initial.trim()) onSave(value);
    if (focusButton) refocus();
    onClose();
  };
  return (
    <td className={open ? cell.open : cell.idle}>
      {open ? (
        <TextEditor
          label={cell.label}
          placeholder={cell.placeholder}
          initial={initial}
          settle={settle}
        />
      ) : (
        <button
          ref={button}
          type="button"
          className="ebook-cell-edit-btn"
          aria-label={`Edit ${field}: ${initial.trim() ? display : "none"}`}
          onClick={onOpen}
        >
          <span className="ebook-title-cell">{display}</span>
        </button>
      )}
    </td>
  );
}

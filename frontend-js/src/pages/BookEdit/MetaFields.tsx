import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { classes } from "../../classes";

/** An input `id` from a label: lowercase, every non-alphanumeric character a hyphen. */
export const labelToId = (label: string) =>
  `me-${label.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "-")}`;

type LabelProps = {
  text: string;
  edited?: boolean;
  hint?: string;
  /** The `id` of the control this labels; leave out when it heads a chip row. */
  target?: string;
};

/** A field label with its "EDITED" badge and hint. */
export function MeLabel({ text, edited, hint, target }: LabelProps) {
  const content = (
    <>
      <span>{text}</span>
      {edited && <span className="mono me-label-edited">· EDITED</span>}
      {hint && <span className="mono me-label-hint">{hint}</span>}
    </>
  );
  return target ? (
    <label className="me-label" htmlFor={target}>
      {content}
    </label>
  ) : (
    <span className="me-label">{content}</span>
  );
}

type FieldProps = Pick<LabelProps, "edited" | "hint"> & {
  label: string;
  /** Columns the field spans: 2, or one. */
  w?: 2;
  /** The big serif title look. */
  big?: boolean;
  mono?: boolean;
  /** Read-only and disabled. */
  locked?: boolean;
  placeholder?: string;
  /** What binds the input: a form's `register(...)`, or a fixed `value`. */
  input: InputHTMLAttributes<HTMLInputElement>;
};

/** A single-line input in the form grid. */
export function MeField({
  label,
  w,
  big,
  mono,
  locked,
  placeholder,
  input,
  edited,
  hint,
}: FieldProps) {
  const id = labelToId(label);
  return (
    <div className={classes("me-field", w === 2 && "me-field-w2")}>
      <MeLabel text={label} edited={edited} hint={hint} target={id} />
      <input
        {...input}
        id={id}
        className={classes(
          "me-input",
          big && "me-input-big me-input-serif",
          mono && "me-input-mono",
          edited && "me-input-edited",
        )}
        placeholder={placeholder || label}
        readOnly={locked}
        disabled={locked}
      />
    </div>
  );
}

type AreaProps = Pick<LabelProps, "edited" | "hint"> & {
  label: string;
  rows: number;
  input: TextareaHTMLAttributes<HTMLTextAreaElement>;
};

/** A multi-line field spanning the grid. */
export function MeArea({ label, rows, input, edited, hint }: AreaProps) {
  const id = labelToId(label);
  return (
    <div className="me-field me-field-full">
      <MeLabel text={label} edited={edited} hint={hint} target={id} />
      <textarea
        {...input}
        id={id}
        className={classes("me-textarea", edited && "me-input-edited")}
        rows={rows}
      />
    </div>
  );
}

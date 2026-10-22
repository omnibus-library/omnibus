import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { classes } from "../../classes";
import { labelToId } from "./editionFields";

type LabelProps = {
  text: string;
  edited?: boolean;
  hint?: string;
  /** The `id` of the control this labels; leave out when it heads a chip row. */
  target?: string;
};

/** A field label with its "Edited" marker and hint. */
export function MeLabel({ text, edited, hint, target }: LabelProps) {
  const content = (
    <>
      <span>{text}</span>
      {edited && <span className="me-label-edited">• Edited</span>}
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
  /** Why the value is refused, under the input. */
  error?: string;
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
  error,
}: FieldProps) {
  const id = labelToId(label);
  return (
    <div className={classes("me-field", w === 2 && "me-field-w2")}>
      <MeLabel text={label} edited={edited} hint={hint} target={id} />
      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
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
      <FieldError id={id} error={error} />
    </div>
  );
}

/** Why a field's value is refused, said once it is typed. */
function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p className="me-field-error" id={`${id}-error`}>
      {error}
    </p>
  ) : null;
}

type AreaProps = Pick<LabelProps, "edited" | "hint"> & {
  error?: string;
  label: string;
  rows: number;
  input: TextareaHTMLAttributes<HTMLTextAreaElement>;
};

/** A multi-line field spanning the grid. */
export function MeArea({ label, rows, input, edited, hint, error }: AreaProps) {
  const id = labelToId(label);
  return (
    <div className="me-field me-field-full">
      <MeLabel text={label} edited={edited} hint={hint} target={id} />
      <textarea
        {...input}
        id={id}
        className={classes("me-textarea", edited && "me-input-edited")}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

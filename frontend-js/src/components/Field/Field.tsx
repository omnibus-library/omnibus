import type { ReactNode } from "react";
import "./Field.css";

type FieldProps = {
  id: string;
  label: string;
  type?: "text" | "password" | "email";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown under the input, and marks the field invalid. */
  error?: string;
  hint?: string;
  /** Draws the ✓ once the value is known good. */
  valid?: boolean;
  /** A link or button beside the label row, such as "Forgot?". */
  action?: ReactNode;
};

function stateClass(error: string | undefined, valid: boolean) {
  if (error) return "auth-field auth-field-err";
  return valid ? "auth-field auth-field-ok" : "auth-field auth-field-neutral";
}

/** A labelled text input in the auth screens' style. */
export function Field({
  id,
  label,
  type = "text",
  autoComplete,
  value,
  onChange,
  error,
  hint,
  valid = false,
  action,
}: FieldProps) {
  return (
    <div className={stateClass(error, valid)}>
      <div className="auth-field-label-row">
        <label className="auth-field-label" htmlFor={id}>
          {label}
        </label>
      </div>
      <div className="auth-field-input-wrap">
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {valid && !error && <span className="auth-field-check">✓</span>}
      </div>
      {action && <span className="auth-field-action">{action}</span>}
      {error && (
        <div className="auth-field-msg auth-field-msg-err" role="alert">
          {error}
        </div>
      )}
      {!error && hint && (
        <div className="auth-field-msg auth-field-msg-hint">{hint}</div>
      )}
    </div>
  );
}

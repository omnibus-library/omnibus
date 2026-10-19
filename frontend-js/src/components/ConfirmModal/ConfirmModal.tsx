import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { BusyLabel } from "../Loading/Loading";
import "./ConfirmModal.css";

const TABBABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

// Wraps Tab from the dialog's last tabbable element to its first, and Shift+Tab the other way.
function trapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  // A dialog opened inside another is the only one that handles its keys.
  event.stopPropagation();
  const dialog = event.currentTarget;
  const tabbable = [...dialog.querySelectorAll<HTMLElement>(TABBABLE)];
  const [first, last] = [tabbable.at(0), tabbable.at(-1)];
  if (!first || !last) return;
  const active = document.activeElement;
  const leaving = event.shiftKey
    ? active === dialog || active === first
    : active === last;
  if (!leaving) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

type ConfirmModalProps = {
  testId: string;
  ariaLabel: string;
  /** The panel's class, such as `mg-modal confirm-modal`. */
  dialogClass: string;
  /** While true, Escape and a click on the backdrop do nothing. */
  busy: boolean;
  onDismiss: () => void;
  backdropClass?: string;
  /** Focuses the dialog so Escape and Tab work; leave off when the body autofocuses a field. */
  focusOnOpen?: boolean;
  children: ReactNode;
};

/** The backdrop and panel every dialog shares: dismiss on Escape or a backdrop click unless busy, Tab kept inside. */
export function ConfirmModal({
  testId,
  ariaLabel,
  dialogClass,
  busy,
  onDismiss,
  backdropClass = "author-photo-modal-backdrop",
  focusOnOpen = false,
  children,
}: ConfirmModalProps) {
  const backdrop = useRef<HTMLDivElement>(null);
  const dismiss = () => {
    if (!busy) onDismiss();
  };
  // Closing hands focus back to what opened it: with a dialog nested in another, to the outer one.
  useEffect(() => {
    if (!focusOnOpen) return;
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [focusOnOpen]);
  // After every render: a button that unmounts or disables drops focus to the page.
  useEffect(() => {
    if (!focusOnOpen) return;
    // After paint, or the focus ring never shows; and not over a field that already has it.
    const frame = requestAnimationFrame(() => {
      const dialog = backdrop.current;
      if (!dialog?.contains(document.activeElement)) dialog?.focus();
    });
    return () => cancelAnimationFrame(frame);
  });
  return (
    <div
      ref={backdrop}
      className={backdropClass}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-testid={testId}
      // Focusable so Escape reaches onKeyDown at all.
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
        trapTab(event);
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: only keeps a click inside the panel from reaching the backdrop */}
      <div className={dialogClass} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export type ConfirmAction = {
  testId: string;
  label: string;
  /** Makes this an action that can work: it swaps to this label with a ring while `busy`. */
  busyLabel?: string;
  busy?: boolean;
  tone: "ghost" | "danger";
  disabled?: boolean;
  onClick: () => void;
};

type ConfirmBodyProps = {
  title: string;
  body: string;
  /** Shown above the buttons, in front of what caused it. */
  note?: ReactNode;
  actions: ConfirmAction[];
};

/** A title, copy, an optional note and a row of buttons: the body of a "confirm one thing" dialog. */
export function ConfirmBody({ title, body, note, actions }: ConfirmBodyProps) {
  return (
    <div className="del-body">
      <h3 className="del-title">{title}</h3>
      <p className="del-copy">{body}</p>
      {note}
      <div className="del-actions">
        {actions.map((action) => {
          const working = Boolean(action.busy && action.busyLabel);
          return (
            <button
              key={action.testId}
              type="button"
              className={
                action.tone === "danger" ? "del-btn-danger" : "del-btn-ghost"
              }
              data-testid={action.testId}
              disabled={action.disabled}
              aria-busy={working}
              onClick={action.onClick}
            >
              {action.busyLabel ? (
                <BusyLabel
                  busy={working}
                  label={action.label}
                  busyLabel={action.busyLabel}
                />
              ) : (
                action.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ConfirmDialogProps = {
  /** The dialog's id; its buttons are `{testId}-cancel` and `{testId}-confirm`. */
  testId: string;
  title: string;
  body: string;
  /** The destructive button's label, and the one it shows while working. */
  action: string;
  busyLabel: string;
  busy: boolean;
  note?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
};

/** A confirm dialog for one destructive action, focused when it opens. */
export function ConfirmDialog({
  testId,
  title,
  body,
  action,
  busyLabel,
  busy,
  note,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <ConfirmModal
      testId={testId}
      ariaLabel={title}
      dialogClass="mg-modal confirm-modal"
      busy={busy}
      onDismiss={onCancel}
      focusOnOpen
    >
      <ConfirmBody
        title={title}
        body={body}
        note={note}
        actions={[
          {
            testId: `${testId}-cancel`,
            label: "Cancel",
            tone: "ghost",
            disabled: busy,
            onClick: onCancel,
          },
          {
            testId: `${testId}-confirm`,
            label: action,
            busyLabel,
            busy,
            tone: "danger",
            disabled: busy,
            onClick: onConfirm,
          },
        ]}
      />
    </ConfirmModal>
  );
}

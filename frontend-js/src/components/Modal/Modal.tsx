import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { trapTab } from "../../focusTrap";

type ModalProps = {
  label: string;
  backdropClass: string;
  dialogClass: string;
  onClose: () => void;
  children: ReactNode;
  /** While true, Escape and a backdrop click do nothing. */
  busy?: boolean;
  /** Where focus lands when the opener is gone by the time the dialog closes. */
  fallbackFocus?: RefObject<HTMLElement | null>;
  backdropTestId?: string;
  dialogTestId?: string;
};

/** A dialog over a backdrop: Escape and a backdrop click close it unless busy, Tab stays inside, focus returns on close. */
export function Modal({
  label,
  backdropClass,
  dialogClass,
  onClose,
  children,
  busy = false,
  fallbackFocus,
  backdropTestId,
  dialogTestId,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  // Read in render: a child's autoFocus has moved focus by the time effects run.
  const opener = useRef(document.activeElement);
  // Every render: a screen swapped inside the dialog drops the focused element, and Escape needs focus in here.
  useEffect(() => {
    // A field that took focus keeps it.
    if (!dialog.current?.contains(document.activeElement)) {
      dialog.current?.focus();
    }
  });
  useEffect(
    () => () => {
      // A saved edit drops the selection and its bar, the opener with them; the table is the next stop.
      const target =
        // A page opened on the sheet had nothing focused: `body` is no opener to hand focus back to.
        opener.current instanceof HTMLElement &&
        opener.current.isConnected &&
        opener.current !== document.body
          ? opener.current
          : fallbackFocus?.current;
      target?.focus();
    },
    [fallbackFocus],
  );
  const dismiss = () => {
    if (!busy) onClose();
  };
  return (
    <div
      ref={dialog}
      className={backdropClass}
      data-testid={backdropTestId}
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
      <div className={dialogClass} data-testid={dialogTestId}>
        {children}
      </div>
    </div>
  );
}

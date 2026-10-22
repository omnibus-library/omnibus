import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../motion";
import { Modal } from "../Modal/Modal";
import "./Sheet.css";

/** Past the longest exit in `Sheet.css` (220 ms on a phone, 160 ms elsewhere), so the sheet leaves the DOM only once it has finished leaving. */
const EXIT_MS = 240;

type SheetProps = {
  label: string;
  /** Escape, the backdrop or a Close button asked to leave; the owner decides, then sets `closing`. */
  onDismiss: () => void;
  /** True plays the exit; `onClosed` runs when it ends, at once under reduced motion. */
  closing: boolean;
  onClosed: () => void;
  busy?: boolean;
  fallbackFocus?: RefObject<HTMLElement | null>;
  testId?: string;
  children: ReactNode;
};

/** A modal panel that rises over the dimmed page and, under 720 px, fills it from the bottom. */
export function Sheet({
  label,
  onDismiss,
  closing,
  onClosed,
  busy = false,
  fallbackFocus,
  testId,
  children,
}: SheetProps) {
  // The owner re-renders while the sheet fades; its newest callback must not restart the exit.
  const closed = useRef(onClosed);
  useEffect(() => {
    closed.current = onClosed;
  });
  useEffect(() => {
    if (!closing) return;
    if (prefersReducedMotion()) return closed.current();
    const exited = setTimeout(() => closed.current(), EXIT_MS);
    return () => clearTimeout(exited);
  }, [closing]);
  return (
    <Modal
      label={label}
      backdropClass={closing ? "sheet-scrim is-closing" : "sheet-scrim"}
      dialogClass="sheet"
      onClose={onDismiss}
      // Leaving is already under way; a second Escape must not ask again.
      busy={busy || closing}
      fallbackFocus={fallbackFocus}
      dialogTestId={testId}
    >
      {children}
    </Modal>
  );
}

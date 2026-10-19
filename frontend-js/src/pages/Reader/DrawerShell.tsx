import type { ReactNode } from "react";
import { classes } from "../../classes";

/** The dim backdrop behind a drawer or panel; a click on it closes whatever is over it. */
export function Scrim({ onClick }: { onClick: () => void }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Escape closes the panel from the keyboard; the scrim is the pointer's way out
    <div className="rd-scrim" onClick={onClick} />
  );
}

type DrawerShellProps = {
  testId: string;
  /** Appended to the drawer's classes; the search panel goes full-screen on phones. */
  extraClass?: string;
  onClose: () => void;
  /** The title, count and sub-line. */
  head: ReactNode;
  /** Grouped with the close button. */
  actions?: ReactNode;
  children: ReactNode;
};

/** The scrim and `rd-drawer` every reader panel shares: grabber, head, close button, then the body. */
export function DrawerShell({
  testId,
  extraClass,
  onClose,
  head,
  actions,
  children,
}: DrawerShellProps) {
  return (
    <>
      <Scrim onClick={onClose} />
      <div className={classes("rd-drawer", extraClass)} data-testid={testId}>
        <div className="rd-grabber" />
        <div className="rd-drawer-head">
          {head}
          <div className="rd-drawer-head-actions">
            {actions}
            <button
              type="button"
              className="rd-x"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        {children}
      </div>
    </>
  );
}

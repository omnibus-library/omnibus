import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "../../components/Button/Button";

type DrawerShellProps = {
  testId: string;
  onClose: () => void;
  /** The kicker and title block. */
  head: ReactNode;
  /** Sits beside the close button. */
  actions?: ReactNode;
  children: ReactNode;
};

/** A scrim and the right-hand drawer: head, actions, close button, then the body. */
export function DrawerShell({
  testId,
  onClose,
  head,
  actions,
  children,
}: DrawerShellProps) {
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a click-away scrim; "Close" is the keyboard's way out */}
      <div className="lp-scrim" onClick={onClose} />
      <div className="lp-drawer" data-testid={testId}>
        <div className="lp-drawer-head">
          {head}
          <div className="lp-drawer-head-actions">
            {actions}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close ↓
            </Button>
          </div>
        </div>
        <div className="lp-drawer-body">{children}</div>
      </div>
    </>
  );
}

type PanelShellProps = {
  /** The panel's own class, such as `lp-speed-panel`. */
  extraClass: string;
  label: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
};

/** A scrim and a small dialog that takes focus on open, so Escape closes it without a click first. */
export function PanelShell({
  extraClass,
  label,
  testId,
  onClose,
  children,
}: PanelShellProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Escape closes the panel from the keyboard; the scrim is the pointer's way out */}
      <div className="lp-scrim" onClick={onClose} />
      <div
        ref={panel}
        className={`lp-panel ${extraClass}`}
        data-testid={testId}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </>
  );
}

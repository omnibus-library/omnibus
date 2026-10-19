import { useEffect, useRef } from "react";
import { type Blocker, useBlocker } from "react-router";
import { trapTab } from "../../focusTrap";
import "./Unsaved.css";

/** Holds in-app navigation and arms the browser's leave prompt while `dirty`. */
export function useLeaveGuard(dirty: boolean) {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowed.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    window.onbeforeunload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    return () => {
      window.onbeforeunload = null;
    };
  }, [dirty]);
  // The page calls this just before it navigates on purpose (a save, a revert).
  const allowLeave = () => {
    allowed.current = true;
  };
  return { blocker, allowLeave };
}

/** "Discard unsaved changes?" for a navigation the guard held back. */
export function UnsavedDialog({ blocker }: { blocker: Blocker }) {
  const dialog = useRef<HTMLDivElement>(null);
  const open = blocker.state === "blocked";
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);
  if (blocker.state !== "blocked") return null;
  return (
    <div
      ref={dialog}
      className="author-photo-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Discard unsaved changes"
      data-testid="unsaved-confirm"
      tabIndex={-1}
      onClick={(e) => e.target === e.currentTarget && blocker.reset()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          blocker.reset();
        }
        trapTab(e, e.currentTarget);
      }}
    >
      <div className="mg-modal del-modal">
        <div className="del-body">
          <h3 className="del-title">Discard unsaved changes?</h3>
          <p className="del-copy">
            You've edited this book's details without saving them.
          </p>
          <div className="del-actions">
            <button
              type="button"
              className="del-btn-ghost"
              data-testid="unsaved-keep"
              onClick={() => blocker.reset()}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="del-btn-danger"
              data-testid="unsaved-discard"
              onClick={() => blocker.proceed()}
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

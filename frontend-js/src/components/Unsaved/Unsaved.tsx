import { useEffect, useRef } from "react";
import { type Blocker, useBlocker } from "react-router";
import { ConfirmBody, ConfirmModal } from "../ConfirmModal/ConfirmModal";

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
  if (blocker.state !== "blocked") return null;
  return (
    <ConfirmModal
      testId="unsaved-confirm"
      ariaLabel="Discard unsaved changes"
      dialogClass="mg-modal del-modal"
      busy={false}
      onDismiss={() => blocker.reset()}
      focusOnOpen
    >
      <ConfirmBody
        title="Discard unsaved changes?"
        body="You've edited this book's details without saving them."
        actions={[
          {
            testId: "unsaved-keep",
            label: "Keep editing",
            tone: "ghost",
            onClick: () => blocker.reset(),
          },
          {
            testId: "unsaved-discard",
            label: "Discard",
            tone: "danger",
            onClick: () => blocker.proceed(),
          },
        ]}
      />
    </ConfirmModal>
  );
}

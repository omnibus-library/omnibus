import { useEffect, useRef } from "react";
import { type Blocker, type Location, useBlocker } from "react-router";
import { ConfirmBody, ConfirmModal } from "../ConfirmModal/ConfirmModal";

const samePathname = (a: Location, b: Location) => a.pathname === b.pathname;

/** Arms the browser's leave prompt while `dirty`, for a sheet that has no data router to block with. */
export function useUnloadGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    // A listener per guard, so one going quiet leaves another's in place.
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/** Holds in-app navigation and arms the browser's leave prompt while `dirty`; `samePlace` says which moves stay on the page. */
export function useLeaveGuard(
  dirty: boolean,
  samePlace: (a: Location, b: Location) => boolean = samePathname,
) {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && !samePlace(currentLocation, nextLocation),
  );
  useUnloadGuard(dirty);
  // The page calls this just before it navigates on purpose (a save, a revert).
  const allowLeave = () => {
    allowed.current = true;
  };
  return { blocker, allowLeave };
}

/** "Discard unsaved changes?" for a navigation the guard held back. */
export function UnsavedDialog({
  blocker,
  body,
}: {
  blocker: Blocker;
  body: string;
}) {
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
        body={body}
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

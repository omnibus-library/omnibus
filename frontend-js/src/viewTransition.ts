import { flushSync } from "react-dom";
import { prefersReducedMotion } from "./motion";

/** How a page change is drawn: the browser's View Transition, a CSS entrance on the new page, or not at all. */
export type TurnMode = "view-transition" | "css" | "instant";

export function turnMode(): TurnMode {
  if (prefersReducedMotion()) return "instant";
  return typeof document.startViewTransition === "function"
    ? "view-transition"
    : "css";
}

/**
 * Runs `update` (a React state change) inside a View Transition when there is one. `updated` resolves
 * once the DOM shows it, `finished` once the turn has been drawn to its end.
 */
export function turnPage(update: () => void): {
  updated: Promise<void>;
  finished: Promise<void>;
} {
  if (turnMode() !== "view-transition") {
    update();
    return { updated: Promise.resolve(), finished: Promise.resolve() };
  }
  // React must commit inside the callback, or the transition snapshots the old page twice.
  const transition = document.startViewTransition(() => flushSync(update));
  // A turn skipped by the next one rejects `ready`; the page is already where it was going.
  transition.ready.catch(() => {});
  // `finished` settles for a skipped turn too, so a caller waiting on it is never left hanging.
  const finished = transition.finished.catch(() => {});
  return { updated: transition.updateCallbackDone, finished };
}

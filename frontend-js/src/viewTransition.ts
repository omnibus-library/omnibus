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

/** Runs `update` (a React state change) inside a View Transition when there is one; resolves once the DOM shows it. */
export function turnPage(update: () => void): Promise<void> {
  if (turnMode() !== "view-transition") {
    update();
    return Promise.resolve();
  }
  // React must commit inside the callback, or the transition snapshots the old page twice.
  const transition = document.startViewTransition(() => flushSync(update));
  // A turn skipped by the next one rejects `ready`; the page is already where it was going.
  transition.ready.catch(() => {});
  return transition.updateCallbackDone;
}

/** The browser's own pointer: a story's `userEvent` is synthetic, dispatching straight to its target past any overlay and never setting `:hover`. */
export const realPointer = async () =>
  (await import("vitest/browser")).userEvent;

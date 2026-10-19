const TABBABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** Wraps Tab from `container`'s last tabbable element to its first, and Shift+Tab back. */
export function trapTab(
  event: { key: string; shiftKey: boolean; preventDefault: () => void },
  container: HTMLElement,
) {
  if (event.key !== "Tab") return;
  const tabbable = container.querySelectorAll<HTMLElement>(TABBABLE);
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (!first || !last) {
    // Nothing to tab to (a save has disabled it all): keep focus here rather than let it escape.
    event.preventDefault();
    container.focus();
    return;
  }
  const active = document.activeElement;
  const leaving = event.shiftKey
    ? active === first || active === container
    : active === last;
  if (!leaving) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

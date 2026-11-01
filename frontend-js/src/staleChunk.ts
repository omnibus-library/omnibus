const RELOAD_KEY = "omn.chunk-reload";
const RELOAD_WINDOW_MS = 10_000;

/** Whether a failed chunk may reload the page: not twice within the window, so a broken deploy can't loop. */
export function shouldReload(
  lastReloadAt: string | null,
  now: number,
): boolean {
  const last = Number(lastReloadAt);
  return !(last > 0) || now - last > RELOAD_WINDOW_MS;
}

/**
 * A tab left open across an upgrade asks for a lazy chunk whose hashed name no
 * longer exists; reloading fetches the new shell, which names the new chunks.
 */
export function reloadOnStaleChunk(
  target: EventTarget,
  storage: Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
  now: () => number = Date.now,
): void {
  target.addEventListener("vite:preloadError", (event) => {
    try {
      if (!shouldReload(storage.getItem(RELOAD_KEY), now())) return;
      storage.setItem(RELOAD_KEY, String(now()));
    } catch {
      return;
    }
    event.preventDefault();
    reload();
  });
}

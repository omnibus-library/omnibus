const RELOAD_KEY = "omn.chunk-reload";

/** What the page needs to tell a stale chunk from a flaky network. */
export interface StaleChunkEnv {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  /** Names the running build; its hashed entry URL by default. */
  build?: string;
  online?: () => boolean;
}

/** A build reloads at most once per session, so a deploy that stays broken can't loop. */
export function shouldReload(
  reloadedBuild: string | null,
  build: string,
): boolean {
  return reloadedBuild !== build;
}

/**
 * A tab left open across an upgrade asks for a lazy chunk whose hashed name no
 * longer exists; reloading fetches the new shell, which names the new chunks.
 * Offline, the chunk is only unreachable, so the route's own retry handles it.
 */
export function reloadOnStaleChunk(
  target: EventTarget,
  {
    storage,
    reload,
    build = import.meta.url,
    online = () => navigator.onLine,
  }: StaleChunkEnv,
): void {
  target.addEventListener("vite:preloadError", (event) => {
    try {
      if (!online() || !shouldReload(storage.getItem(RELOAD_KEY), build))
        return;
      storage.setItem(RELOAD_KEY, build);
    } catch {
      return;
    }
    event.preventDefault();
    reload();
  });
}

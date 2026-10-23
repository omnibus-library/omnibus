// Session-scoped window scroll restoration, a port of the Dioxus client's
// frontend/src/scroll_restore.rs (RESTORE_JS and its two hooks). Offsets live in
// memory per route path; a page's content arrives after mount, so a restore
// retries each frame until the window reaches the offset.
import { useEffect, useLayoutEffect, useRef } from "react";

const positions = new Map<string, number>();
// The route path the mounted hooks report. Not `location.pathname`: a memory router never moves that.
let routePath: string | null = null;
// Path whose offsets are trusted. Null while a route transition or history navigation settles; `restore` re-arms it.
let recordPath: string | null = null;
// Stops the restore still converging, so a newer one supersedes it rather than both scrolling at once.
// `location.pathname` when recording was last armed: a popstate that leaves it unchanged (a `#fragment` traversal) keeps recording.
let armedLocation: string | null = null;
let stopRunning: (() => void) | null = null;
let pendingFrame = 0;
let installed = false;

function record() {
  pendingFrame = 0;
  if (recordPath === null || routePath !== recordPath) return;
  positions.set(recordPath, window.scrollY);
}

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener(
    "scroll",
    () => {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(record);
    },
    { passive: true },
  );
  window.addEventListener("popstate", () => {
    if (window.location.pathname !== armedLocation) recordPath = null;
  });
}

/** Puts the window at `path`'s saved offset, retrying until reached, the reader scrolls, the page stops growing or 6 s pass. `toTopIfNone` starts an unseen path at the top. */
function restore(path: string, toTopIfNone: boolean) {
  install();
  stopRunning?.();
  const target = positions.get(path);
  const rearm = () => {
    recordPath = path;
    armedLocation = window.location.pathname;
  };
  // Only a missing entry is unseen; a saved 0 is the top, which a remount must restore too.
  if (target === undefined || target <= 0) {
    if (target !== undefined || toTopIfNone) window.scrollTo(0, 0);
    rearm();
    return;
  }
  let cancelled = false;
  const unlisten = () => {
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchstart", cancel);
    window.removeEventListener("keydown", cancel);
    stopRunning = null;
  };
  const teardown = () => {
    unlisten();
    rearm();
  };
  const cancel = () => {
    cancelled = true;
    teardown();
  };
  // Superseded: stop without re-arming, as the newer restore owns recording.
  stopRunning = () => {
    cancelled = true;
    unlisten();
  };
  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchstart", cancel, { passive: true });
  window.addEventListener("keydown", cancel);
  const start = performance.now();
  let lastMax = -1;
  let lastGrewAt = start;
  const step = (now: number) => {
    if (cancelled) return;
    window.scrollTo(0, target);
    if (Math.abs(window.scrollY - target) < 2) return teardown();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > lastMax) {
      lastMax = max;
      lastGrewAt = now;
    }
    // No more growth while still too short means no more content is coming.
    const stalled = max < target && now - lastGrewAt > 1500;
    if (stalled || now - start > 6000) return teardown();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Test-only: drops every saved offset and stops any restore in flight. */
export function forgetScrollPositions() {
  stopRunning?.();
  cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  positions.clear();
  routePath = null;
  recordPath = null;
  armedLocation = null;
}

/** Reports the route path and freezes recording at each change, until that path's restore re-arms it. */
function useRoutePath(path: string) {
  useLayoutEffect(() => {
    routePath = path;
    recordPath = null;
    return () => {
      routePath = null;
      stopRunning?.();
    };
  }, [path]);
}

/** Restores `path`'s saved offset once `ready` first turns true (its content has painted); once per mount, and a path never scrolled stays where the window is. */
export function useScrollRestore(ready: boolean, path: string) {
  const done = useRef(false);
  useRoutePath(path);
  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    restore(path, false);
  }, [ready, path]);
}

/** For a layout that stays mounted while the route changes under it: on each change of `path` after the first, restores its saved offset, or goes to the top if it has none. */
export function useScrollRestoreOnChange(path: string) {
  const last = useRef(path);
  useRoutePath(path);
  useLayoutEffect(() => {
    if (last.current === path) return;
    last.current = path;
    restore(path, true);
  }, [path]);
}

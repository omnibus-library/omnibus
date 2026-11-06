import { useEffect, useState } from "react";
import type { BookRequest } from "../../api";
import { nowSecs } from "../../format";
import { timeLeft } from "./requestView";

/** How often a download's time left is read again. */
const TICK_MS = 30_000;

/** A download's time left, "about 3 min left", counted down every 30 seconds; `null` when there is none to show. */
export function useTimeLeft(
  download: Pick<BookRequest, "expectedDoneAt" | "progress">,
) {
  // Only re-renders: the clock is read fresh on every render, so a poll's re-render counts too.
  const [, tick] = useState(0);
  const counting = download.expectedDoneAt !== null;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => tick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [counting]);
  return timeLeft(download, nowSecs());
}

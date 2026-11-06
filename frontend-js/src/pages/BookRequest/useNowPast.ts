import { useEffect, useState } from "react";
import { nowSecs } from "../../format";

/** The clock in Unix seconds, read again once `deadline` (Unix seconds) has passed, so a view that turns then re-renders. */
export function useNowPast(deadline: number | null) {
  const [now, setNow] = useState(nowSecs);
  useEffect(() => {
    if (deadline === null) return;
    const wait = deadline - nowSecs();
    if (wait < 0) {
      // Already past on arrival: read the clock now, or a stale one holds until something else re-renders.
      setNow(nowSecs());
      return;
    }
    const timer = setTimeout(() => setNow(nowSecs()), (wait + 1) * 1000);
    return () => clearTimeout(timer);
  }, [deadline]);
  return now;
}

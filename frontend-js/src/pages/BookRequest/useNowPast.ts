import { useEffect, useState } from "react";
import { nowSecs } from "../../format";

/** The clock in Unix seconds, read again once `deadline` (Unix seconds) has passed, so a view that turns then re-renders. */
export function useNowPast(deadline: number | null) {
  const [now, setNow] = useState(nowSecs);
  useEffect(() => {
    if (deadline === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Re-arms while the clock still reads before the deadline, so an early fire does not strand the view.
    const tick = () => {
      const wait = deadline - nowSecs();
      setNow(nowSecs());
      if (wait >= 0) timer = setTimeout(tick, (wait + 1) * 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [deadline]);
  return now;
}

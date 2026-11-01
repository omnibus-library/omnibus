import { useCallback, useState } from "react";

/** Whether any work handed to `settle` is still running, so a page can hold a control until an add's refetch lands. */
export function useSettling(): [boolean, (work: Promise<unknown>) => void] {
  const [running, setRunning] = useState(0);
  const settle = useCallback((work: Promise<unknown>) => {
    setRunning((n) => n + 1);
    const done = () => setRunning((n) => n - 1);
    work.then(done, done);
  }, []);
  return [running > 0, settle];
}

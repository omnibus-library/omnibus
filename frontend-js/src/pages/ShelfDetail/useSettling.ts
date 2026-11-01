import { useCallback, useState } from "react";

/** Whether the refetch an add on `shelfId` set off is still out; another shelf's add holds nothing here. */
export function useSettling(
  shelfId: number | null,
): [boolean, (id: number, work: Promise<unknown>) => void] {
  const [settlingId, setSettlingId] = useState<number | null>(null);
  // Both openers refuse while settling, so a second add can't overlap the first.
  const settle = useCallback((id: number, work: Promise<unknown>) => {
    setSettlingId(id);
    const done = () => setSettlingId((now) => (now === id ? null : now));
    work.then(done, done);
  }, []);
  return [shelfId !== null && settlingId === shelfId, settle];
}

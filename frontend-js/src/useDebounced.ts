import { useEffect, useState } from "react";

const DEBOUNCE_MS = 150;

/** `value`, once it has held still for a moment. */
export function useDebounced(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

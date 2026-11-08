import { useSyncExternalStore } from "react";

/** The phone line most of the app's layout keys off. */
export const PHONE_QUERY = "(max-width: 720px)";

/** Whether `query` matches now, and again whenever that changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

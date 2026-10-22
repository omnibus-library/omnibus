import { useRef, useState } from "react";
import { fillMissing, hydrateEdition, type ProviderEdition } from "../../api";

/** The candidate being looked at; `hydrating` while its full record is still on the way. */
type Picked = { edition: ProviderEdition; hydrating: boolean };

/**
 * The edition picked from a list and its full record, fetched once it is picked. The full
 * record fills in what the list row lacked and never takes a field away from it, and a slow
 * answer cannot overwrite a pick the reader has since replaced, or reappear after they cleared it.
 */
export function useHydrated() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const latest = useRef(0);

  const pick = (edition: ProviderEdition) => {
    setPicked({ edition, hydrating: true });
    const request = ++latest.current;
    const land = (settled: ProviderEdition) =>
      setPicked((now) =>
        now && request === latest.current
          ? { edition: settled, hydrating: false }
          : now,
      );
    hydrateEdition(edition).then(
      (full) => land(full ? fillMissing(full, edition) : edition),
      () => land(edition),
    );
  };
  const clear = () => setPicked(null);
  return { picked, pick, clear };
}

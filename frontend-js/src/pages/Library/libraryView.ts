export type EmptyState = "none" | "empty" | "filtered";

/**
 * What an empty book area says. Pass the filter the list was fetched under:
 * a filter that rules every book out is "filtered", not an empty library.
 */
export function emptyState(bookCount: number, filtered: boolean): EmptyState {
  if (bookCount > 0) return "none";
  return filtered ? "filtered" : "empty";
}

/**
 * The receipt's count: shown only under a filter, "counting" until the list
 * has answered (never a stale or zero count), and absent after a failure
 * unless the total was already known.
 */
export function headerCount(
  filtered: boolean,
  total: number | null,
  failed: boolean,
): number | "counting" | null {
  if (!filtered) return null;
  if (total !== null) return total;
  return failed ? null : "counting";
}

/** The formats the reader's preference hides, worded "Hidden: M4B, MP3"; null when it hides none. */
export function hiddenFormatsLabel(formats: string[]): string | null {
  if (formats.length === 0) return null;
  return `Hidden: ${formats
    .map((f) => f.toUpperCase())
    .sort()
    .join(", ")}`;
}

import type { HouseholdReader, UserId } from "../../api";

/** Whose figures the page shows: the caller's own, or another reader's by the household list's name. */
export type Viewing = { kind: "you" } | { kind: "reader"; name: string };

const UNLISTED_READER = "Another reader";

/**
 * Resolves `?user=` against the household list. An unlisted id still needs somewhere to
 * point (a stale link, a reader who just turned sharing off), so it names no one in particular.
 */
export function viewing(
  user: UserId | null,
  readers: readonly HouseholdReader[],
): Viewing {
  if (user === null) return { kind: "you" };
  const reader = readers.find((r) => r.id === user);
  if (!reader) return { kind: "reader", name: UNLISTED_READER };
  return reader.is_you
    ? { kind: "you" }
    : { kind: "reader", name: reader.name };
}

/** The hero's heading. The caller's own page has none, so its first-person copy applies. */
export const heading = (who: Viewing) =>
  who.kind === "you" ? null : `${who.name}'s stats`;

/** Whether the picker has anything to offer, which is true when at least one reader besides the caller shares. */
export const showsPicker = (readers: readonly HouseholdReader[]) =>
  readers.some((r) => !r.is_you);

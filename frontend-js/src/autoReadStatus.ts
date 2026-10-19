import { useEffect, useState } from "react";
import {
  type BookUuid,
  fetchReadStatus,
  inOrder,
  type ReadStatusValue,
  saveReadStatus,
} from "./api";

const statusWrites = new Map<string, Promise<void>>();

/** The status to write for a book stored as `current`; `null` for no write, so opening never downgrades `finished`. */
export function autoTransition(
  current: ReadStatusValue,
  atEnd: boolean,
): ReadStatusValue | null {
  if (atEnd) return current === "finished" ? null : "finished";
  return current === "unread" ? "reading" : null;
}

/** Moves the book's read status once: `reading` on first play, `finished` at the end. Best-effort; a failed fetch decides nothing. */
export async function applyAutoReadStatus(
  uuid: BookUuid,
  atEnd: boolean,
): Promise<void> {
  // Read, decide and write as one step in the book's queue, so a slow `reading` can't land after `finished`.
  await inOrder(statusWrites, uuid, async () => {
    const stored = await fetchReadStatus(uuid).then(
      (record) => record?.status ?? "unread",
      () => null,
    );
    if (stored === null) return;
    const next = autoTransition(stored, atEnd);
    if (next === null) return;
    await saveReadStatus(uuid, next).catch(() => {});
  });
}

/**
 * Moves the read status as the reader goes: opening an unread book marks it reading, and
 * reaching `atEnd` marks it finished. Writes are best-effort; the next open retries.
 */
export function useAutoReadStatus(uuid: BookUuid, atEnd: boolean): void {
  // Keyed by the book it describes, so no decision is made against another book's status.
  const [stored, setStored] = useState<{
    uuid: BookUuid;
    status: ReadStatusValue;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStored(null);
    fetchReadStatus(uuid).then(
      (record) => {
        if (!cancelled) {
          setStored({ uuid, status: record?.status ?? "unread" });
        }
      },
      // A failed fetch decides nothing: writing `reading` over an unfetched `finished` would downgrade it.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  useEffect(() => {
    if (stored?.uuid !== uuid) return;
    const next = autoTransition(stored.status, atEnd);
    if (!next) return;
    // Optimistic, so the re-render this causes settles instead of repeating the write.
    setStored({ uuid, status: next });
    // Ordered, so a slow `reading` can't land after `finished` and overwrite it.
    inOrder(statusWrites, uuid, () => saveReadStatus(uuid, next)).catch(
      () => {},
    );
  }, [stored, atEnd, uuid]);
}

import {
  type BookUuid,
  fetchReadStatus,
  type ListeningReport,
  type ReadStatusValue,
  saveReadStatus,
} from "../api";

/** Sittings shorter than this are a bounce into and out of a book, not listening. */
export const MIN_SESSION_SECS = 5;

function report(
  uuid: BookUuid,
  start: number,
  end: number,
): ListeningReport | null {
  if (end - start < MIN_SESSION_SECS) return null;
  return {
    book_uuid: uuid,
    format: "audio",
    started_at: start,
    ended_at: end,
    progress_units: end - start,
    // Where the clock stood when the sitting began, east-positive (rule 10).
    utc_offset_minutes: -new Date(start * 1000).getTimezoneOffset(),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// shortcut: duplicates OMNI-2785's SessionTracker; fold into it once both land
/** The stretch of one book playing, as unix seconds the caller injects. */
export class ListeningTracker {
  #active: { uuid: BookUuid; startedAt: number } | null = null;

  /** The book is playing; starting what is already running is a no-op. */
  start(uuid: BookUuid, now: number): void {
    this.#active ??= { uuid, startedAt: now };
  }

  /** Ends the stretch; `null` when none ran or it was too short. */
  stop(now: number): ListeningReport | null {
    const active = this.#active;
    this.#active = null;
    return active && report(active.uuid, active.startedAt, now);
  }

  /** The heartbeat: reports the running stretch and restarts it at `now`; one under the floor keeps accruing. */
  rollover(now: number): ListeningReport | null {
    const active = this.#active;
    if (!active || now - active.startedAt < MIN_SESSION_SECS) return null;
    this.#active = { ...active, startedAt: now };
    return report(active.uuid, active.startedAt, now);
  }
}

// shortcut: duplicates OMNI-2785's autoTransition; fold into it once both land
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
  const stored = await fetchReadStatus(uuid).then(
    (record) => record?.status ?? "unread",
    () => null,
  );
  if (stored === null) return;
  const next = autoTransition(stored, atEnd);
  if (next) await saveReadStatus(uuid, next).catch(() => {});
}

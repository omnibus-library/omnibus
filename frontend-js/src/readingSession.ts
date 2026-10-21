import { useEffect } from "react";
import { type BookUuid, postSessions, type SessionReport } from "./api";
import { nowSecs } from "./format";

/** Sittings shorter than this are a bounce into and out of a book, not reading. */
const MIN_SESSION_SECS = 5;
const HEARTBEAT_MS = 60_000;

type Phase =
  | { kind: "idle" }
  | { kind: "paused"; uuid: BookUuid }
  | { kind: "active"; uuid: BookUuid; startedAt: number };

function report(
  format: SessionReport["format"],
  uuid: BookUuid,
  start: number,
  end: number,
): SessionReport | null {
  if (end - start < MIN_SESSION_SECS) return null;
  return {
    book_uuid: uuid,
    format,
    started_at: start,
    ended_at: end,
    progress_units: end - start,
    // Where the clock stood when the sitting began, east-positive (rule 10).
    utc_offset_minutes: -new Date(start * 1000).getTimezoneOffset(),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** The active-segment machine behind a reader's session capture; `now` is injected, in unix seconds. */
export class SessionTracker {
  #phase: Phase = { kind: "idle" };
  readonly #format: SessionReport["format"];

  constructor(format: SessionReport["format"] = "epub") {
    this.#format = format;
  }

  /** `uuid` is in front and counting: the same book again is a no-op, another book reports the old segment. */
  start(uuid: BookUuid, now: number): SessionReport | null {
    const phase = this.#phase;
    if (phase.kind === "active" && phase.uuid === uuid) return null;
    const ended = this.#take(now);
    this.#phase = { kind: "active", uuid, startedAt: now };
    return ended;
  }

  /** Ends the segment and forgets the book. */
  stop(now: number): SessionReport | null {
    const ended = this.#take(now);
    this.#phase = { kind: "idle" };
    return ended;
  }

  /** Ends the segment but remembers the book, so `resume` can restart it. */
  suspend(now: number): SessionReport | null {
    const ended = this.#take(now);
    if (this.#phase.kind === "active") {
      this.#phase = { kind: "paused", uuid: this.#phase.uuid };
    }
    return ended;
  }

  resume(now: number): void {
    if (this.#phase.kind === "paused") {
      this.#phase = { kind: "active", uuid: this.#phase.uuid, startedAt: now };
    }
  }

  /** The heartbeat: reports the running segment and restarts it at `now`; one under the floor keeps accruing. */
  rollover(now: number): SessionReport | null {
    const phase = this.#phase;
    if (phase.kind !== "active" || now - phase.startedAt < MIN_SESSION_SECS) {
      return null;
    }
    this.#phase = { ...phase, startedAt: now };
    return report(this.#format, phase.uuid, phase.startedAt, now);
  }

  #take(now: number): SessionReport | null {
    const phase = this.#phase;
    return phase.kind === "active"
      ? report(this.#format, phase.uuid, phase.startedAt, now)
      : null;
  }
}

/**
 * Records reading time against `uuid` while the reader is mounted and the tab visible: flushed
 * when the tab hides, every minute, and when the reader unmounts or the page goes away.
 */
export function useReadingSession(uuid: BookUuid): void {
  useEffect(() => {
    const tracker = new SessionTracker();
    const send = (r: SessionReport | null) => {
      if (r) void postSessions([r]);
    };
    tracker.start(uuid, nowSecs());
    const suspend = () => send(tracker.suspend(nowSecs()));
    // Mounted in a background tab: no visibilitychange will fire to pause the segment just started.
    if (document.visibilityState === "hidden") suspend();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        suspend();
      } else {
        tracker.resume(nowSecs());
      }
    };
    // A bfcache restore fires no visibilitychange on some engines.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && document.visibilityState === "visible") {
        tracker.resume(nowSecs());
      }
    };
    const flush = () => send(tracker.stop(nowSecs()));
    const heartbeat = setInterval(
      () => send(tracker.rollover(nowSecs())),
      HEARTBEAT_MS,
    );
    document.addEventListener("visibilitychange", onVisibility);
    // Suspend, not stop: a page restored from the back/forward cache is visible again and resumes.
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", onPageShow);
      flush();
    };
  }, [uuid]);
}

import type { ListeningCandidate, ListeningResume } from "./api";
import { formatHmsShort } from "./resume";
import { read, write } from "./viewPrefs";

// With follow off, the reader and player offer the other format's place instead of moving to
// it. The copy and the re-arm rule match iOS's (SyncPromptStore).

export type OfferTarget = "epub" | "audio";

/** What the card says. */
export type OfferCopy = { title: string; detail: string };

// Per account: household readers can share a browser.
const dismissedKey = (userId: number, uuid: string, target: OfferTarget) =>
  `omn.syncprompt::${userId}::${uuid}::${target}`;

/** An offer the reader declined or took stays quiet until the other format's position is saved again. */
export function shouldOffer(
  sourceClock: number,
  dismissed: number | null,
): boolean {
  return dismissed === null || sourceClock > dismissed;
}

/** The newest source clock this account declined or took for the book. */
export function dismissedClock(
  userId: number,
  uuid: string,
  target: OfferTarget,
): number | null {
  const raw = read(dismissedKey(userId, uuid, target));
  const clock = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(clock) ? clock : null;
}

/** The clock to store: never older than what another tab answered, or that tab's newer offer would come back. */
export function newestDismissed(stored: number | null, clock: number): number {
  return stored === null ? clock : Math.max(stored, clock);
}

/** Remembers an answered offer. Never a progress write. */
export function storeDismissedClock(
  userId: number,
  uuid: string,
  target: OfferTarget,
  clock: number,
) {
  const stored = newestDismissed(dismissedClock(userId, uuid, target), clock);
  write(dismissedKey(userId, uuid, target), String(stored));
}

/** The reader's copy. An earlier listening position must not read as further on; `null` with no percent to name. */
export function readerOfferCopy(
  percent: number | null | undefined,
  sourceAhead: boolean | null | undefined,
): OfferCopy | null {
  if (percent == null) return null;
  return sourceAhead === false
    ? {
        title: "Audiobook is earlier in the book",
        detail: `Your listening maps to about ${percent}% — before this page.`,
      }
    : {
        title: "Listened further in the audiobook",
        detail: `Your listening maps to about ${percent}% through.`,
      };
}

/** The player's copy (see `readerOfferCopy`). */
export function playerOfferCopy(
  seconds: number | null,
  sourceAhead: boolean | null,
): OfferCopy | null {
  if (seconds === null) return null;
  return {
    title:
      sourceAhead === false
        ? "Re-reading earlier in the ebook"
        : "Read further in the ebook",
    detail: `Your reading maps to about ${formatHmsShort(seconds)}.`,
  };
}

/** The candidate a follow-off link offers the player; follow on resolves at boot instead. */
export function listeningOffer(
  resume: ListeningResume | null,
): ListeningCandidate | null {
  if (!resume || resume.follow || resume.state !== "candidate") return null;
  return resume.candidate;
}

/** Whether the reader shows an offer: not over the failed-load overlay, and not already answered. */
export function readerOfferVisible(
  sourceClock: number,
  failed: boolean,
  dismissed: number | null,
): boolean {
  return !failed && shouldOffer(sourceClock, dismissed);
}

/**
 * Whether the player shows `offer`: a source is committed, playback hasn't failed, the
 * mapped file is the one loaded (its seconds count from that file's start), and the offer
 * hasn't been answered. A Go before the boot's restore lands is safe: the engine's seek
 * replaces a seek still waiting on metadata.
 */
export function playerOfferVisible(
  offer: ListeningCandidate,
  ready: boolean,
  failed: boolean,
  loadedFileId: number | null,
  dismissed: number | null,
): boolean {
  return (
    ready &&
    !failed &&
    offer.fileId !== null &&
    offer.fileId === loadedFileId &&
    shouldOffer(offer.sourceClock, dismissed)
  );
}

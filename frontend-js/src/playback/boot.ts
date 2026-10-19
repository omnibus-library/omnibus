import type { ListeningResume, ListeningRow } from "../api";
import { read, write } from "../viewPrefs";

// The localStorage keys the Dioxus client uses; both clients share the origin, so the values.
const positionKey = (uuid: string) => `omn.listening::${uuid}`;
const rateKey = (userId: number, uuid: string) =>
  `omn.listening.rate::${userId}::${uuid}`;
const VOLUME_KEY = "omnibus.listen.volume";

export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

/**
 * Where to seed playback, given the file the manifest loaded. A single-file book (or a server
 * that sends no file count) takes the saved seconds, else the local copy. A multi-file book
 * takes them only when they were taken in the loaded file; otherwise `null`, which is
 * unseeded and never 0: a 0 would be saved over the row the seconds really belong to.
 */
export function resolveBootPosition(
  row: ListeningRow | null,
  local: number | null,
  loadedFileId: number | null,
  fileCount: number,
): number | null {
  if (fileCount <= 1) return row?.seconds ?? local ?? 0;
  return row?.fileId != null &&
    row.fileId === loadedFileId &&
    row.seconds !== null
    ? row.seconds
    : null;
}

/**
 * With follow on and a mapped candidate, the file and seconds to boot at instead of the saved
 * row. An explicit pick of another file stands it aside; a candidate naming no file is
 * malformed, and must not seed seconds into whatever file the row resolves.
 */
export function resolveFollowBoot(
  explicitFile: number | null,
  resume: ListeningResume | null,
): { fileId: number; seconds: number } | null {
  if (!resume?.follow || resume.state !== "candidate") return null;
  const candidate = resume.candidate;
  if (!candidate || candidate.fileId === null || candidate.seconds === null)
    return null;
  if (explicitFile !== null && explicitFile !== candidate.fileId) return null;
  return { fileId: candidate.fileId, seconds: candidate.seconds };
}

/** The boot position: the follow seconds if the manifest loaded their file, else the saved row's. */
export function bootResumePosition(
  follow: { fileId: number; seconds: number } | null,
  row: ListeningRow | null,
  local: number | null,
  loadedFileId: number | null,
  fileCount: number,
): number | null {
  // Not loaded when a dead row's fallback swapped the file; an unknown file (null) takes it.
  if (follow && (loadedFileId === null || follow.fileId === loadedFileId))
    return follow.seconds;
  return resolveBootPosition(row, local, loadedFileId, fileCount);
}

/** The speed to play at, and whether the server has none to be seeded with this device's. A failed fetch is not "none". */
export function resolveRate(
  server: number | null | "failed",
  local: number | null,
): { rate: number; seed: boolean } {
  if (server === "failed") return { rate: local ?? 1, seed: false };
  if (server !== null) return { rate: server, seed: false };
  return local === null
    ? { rate: 1, seed: false }
    : { rate: local, seed: true };
}

/** Whether to boot: a new book, or an explicit other file of this one; a bare relink resumes the current file. */
export function needsReload(
  loaded: { uuid: string; fileId: number | null } | null,
  uuid: string,
  fileId: number | null,
): boolean {
  if (loaded?.uuid !== uuid) return true;
  return fileId !== null && fileId !== loaded.fileId;
}

/**
 * Decides which positions are saved: a heartbeat at most every 5 s and only once the user
 * acted, every seek at once, a pause only after the user acted. `save` is fire-and-forget.
 */
export function createPositionSaver(save: (seconds: number) => void) {
  let lastSaved = 0;
  return {
    time(seconds: number, userActed: boolean) {
      if (!userActed || Math.abs(seconds - lastSaved) < 5) return;
      lastSaved = seconds;
      save(seconds);
    },
    seeked(seconds: number) {
      lastSaved = seconds;
      save(seconds);
    },
    pause(seconds: number, userActed: boolean) {
      if (userActed) save(seconds);
    },
  };
}

const parse = (raw: string | null) => (raw === null ? Number.NaN : Number(raw));

/** The position this device last saved for the book, in seconds. */
export function loadLocalPosition(uuid: string): number | null {
  const seconds = parse(read(positionKey(uuid)));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function saveLocalPosition(uuid: string, seconds: number) {
  write(positionKey(uuid), String(seconds));
}

/** The speed this device last saved for the book, if it is one the server would take. */
export function loadLocalRate(userId: number, uuid: string): number | null {
  const rate = parse(read(rateKey(userId, uuid)));
  return rate >= MIN_RATE && rate <= MAX_RATE ? rate : null;
}

export function saveLocalRate(userId: number, uuid: string, rate: number) {
  write(rateKey(userId, uuid), String(rate));
}

/** The saved volume, 0 to 1; full when nothing usable is saved. */
export function loadVolume(): number {
  const volume = parse(read(VOLUME_KEY));
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
}

export function saveVolume(volume: number) {
  write(VOLUME_KEY, String(volume));
}

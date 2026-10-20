import type { GhostFilesWarning, ScanTallies, TaskKind } from "../../api";

const KIND_LABELS = {
  scan: { running: "Scanning library", finished: "Library scan" },
  generate_thumbs: {
    running: "Generating thumbnail",
    finished: "Thumbnail generation",
  },
  resolve_author_photo: {
    running: "Resolving author photo",
    finished: "Author photo lookup",
  },
  refetch_author_photos: {
    running: "Refetching author photos",
    finished: "Author photo refetch",
  },
  backfill_chapters: {
    running: "Extracting audiobook chapters",
    finished: "Audiobook chapter extraction",
  },
  resolve_suggestions: {
    running: "Finding suggestions",
    finished: "Suggestion lookup",
  },
} satisfies Record<TaskKind, { running: string; finished: string }>;

/** A task kind in words; `running` picks the tense ("Scanning library" or "Library scan"). */
export function workerKindLabel(kind: TaskKind, running: boolean): string {
  return KIND_LABELS[kind][running ? "running" : "finished"];
}

/** The scan's change buckets without the zero ones, or "no changes". */
export function talliesChanges(tallies: ScanTallies): string {
  const parts = (
    [
      [tallies.new, "new"],
      [tallies.changed, "changed"],
      [tallies.removed, "removed"],
      [tallies.moved, "moved"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}`);
  return parts.length > 0 ? parts.join(" · ") : "no changes";
}

/** A running scan's tally line: the files its walk found, then what changed. */
export function activeTalliesLine(tallies: ScanTallies): string {
  return `Found ${tallies.found} — ${talliesChanges(tallies)}`;
}

/** The warning row's text for a scan that dropped many books' files. */
export function ghostWarningMessage({
  removed,
  total,
}: GhostFilesWarning): string {
  return `${removed} of ${total} books lost their files in this scan — check that your library path is mounted.`;
}

// More failures than this collapse into an "and N more" tail.
const BAKE_ERRORS_INLINE_CAP = 5;

/** The bake-errors row's text: the failed books' uuids, capped. */
export function bakeErrorsMessage(errors: readonly string[]): string {
  const n = errors.length;
  const listed = errors.slice(0, BAKE_ERRORS_INLINE_CAP).join(", ");
  const books = `${n} book${n === 1 ? "" : "s"} failed to bake: ${listed}`;
  return n > BAKE_ERRORS_INLINE_CAP
    ? `${books}, and ${n - BAKE_ERRORS_INLINE_CAP} more.`
    : `${books}.`;
}

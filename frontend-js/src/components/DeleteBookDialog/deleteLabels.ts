import type { DeletionManifest } from "../../api";

type Picked = { files: ReadonlySet<number>; copies: ReadonlySet<number> };

export const itemCount = (m: DeletionManifest) =>
  m.files.length + m.copies.length;

const fileName = (f: DeletionManifest["files"][number]) =>
  f.label?.trim() ? f.label : f.filename;

const IMPACT = [
  ["highlights", "highlight", "highlights"],
  ["journal_entries", "journal entry", "journal entries"],
  ["bookmarks", "bookmark", "bookmarks"],
  ["reading_sessions", "reading session", "reading sessions"],
  ["listening_sessions", "listening session", "listening sessions"],
  // The wire field kept its old name; it counts reviews, stars-only ones included.
  ["ratings", "review", "reviews"],
  ["shelves", "shelf placement", "shelf placements"],
] as const;

/** The reader data a total delete takes with it, as phrases: ["3 highlights", "1 review"]. */
export function losses(impact: DeletionManifest["impact"]): string[] {
  return IMPACT.flatMap(([key, one, many]) =>
    impact[key] > 0 ? [`${impact[key]} ${impact[key] === 1 ? one : many}`] : [],
  );
}

/** The step-1 copy and the continue button, which names an action rather than a count while nothing is picked. */
export function chooseLabels(manifest: DeletionManifest, picked: number) {
  const hasCopies = manifest.copies.length > 0;
  // "item" once a physical copy is in play: not every row is a file.
  const noun = `${hasCopies ? "item" : "file"}${picked === 1 ? "" : "s"}`;
  const n = manifest.files.length;
  return {
    action: picked === 0 ? `Delete ${noun}…` : `Delete ${picked} ${noun}…`,
    intro: hasCopies
      ? "Choose what to remove. Files are deleted from disk; a physical copy is only un-recorded."
      : "Choose the files to remove. Each one is deleted from disk and from the library database. This cannot be undone.",
    // With copies the count would misread as the item total.
    filesHead: hasCopies
      ? "FILES ON DISK"
      : `${n === 1 ? "1 FILE" : `${n} FILES`} ON DISK`,
    allPicked: picked === itemCount(manifest),
  };
}

// The single picked file quoted by its label, else the counts by kind.
function pickedLabel(manifest: DeletionManifest, { files, copies }: Picked) {
  const single =
    files.size === 1 && copies.size === 0
      ? manifest.files.find((f) => files.has(f.id))
      : undefined;
  if (single) return `“${fileName(single)}”`;
  return [
    files.size > 0 && `${files.size} file${files.size === 1 ? "" : "s"}`,
    copies.size > 0 &&
      `${copies.size} ${copies.size === 1 ? "copy" : "copies"}`,
  ]
    .filter(Boolean)
    .join(" and ");
}

/**
 * The step-2 heading, copy and button. Three shapes: no items at all, a partial delete the
 * book survives, and a total delete that takes the book (and, only then, the reader data).
 */
export function confirmLabels(
  title: string,
  manifest: DeletionManifest,
  picked: Picked,
) {
  const count = picked.files.size + picked.copies.size;
  const empty = itemCount(manifest) === 0;
  const total = empty || count === itemCount(manifest);
  const remaining = itemCount(manifest) - count;
  const hasCopies = manifest.copies.length > 0;
  const noun = (n: number) =>
    `${hasCopies ? "item" : "file"}${n === 1 ? "" : "s"}`;
  const quoted = `“${title}”`;

  const heading =
    empty || (total && count === 1)
      ? `Delete ${quoted}?`
      : total
        ? `Delete all ${count} ${noun(count)}?`
        : `Delete ${count} ${noun(count)}?`;

  let copy: string;
  if (empty) {
    copy =
      "This book has no files on disk. Deleting removes the library record only — nothing is deleted from your filesystem.";
  } else if (total && manifest.files.length === 0) {
    copy = `${quoted} has no files on disk. Its physical copies will be un-recorded and the book removed from your library entirely — nothing is deleted from your filesystem.`;
  } else if (total) {
    copy = `Every file for ${quoted} will be deleted from disk, ${hasCopies ? "its physical copies un-recorded, " : ""}and the book will be removed from your library entirely.`;
  } else {
    const label = pickedLabel(manifest, picked);
    const stays = `${title} stays in your library with its ${remaining} remaining ${noun(remaining)}.`;
    copy =
      picked.files.size === 0
        ? `${label} will be un-recorded — nothing is deleted from disk. ${stays}`
        : picked.copies.size === 0
          ? `${label} will be deleted from disk and removed from this book. ${stays}`
          : `${label} will be removed from this book — files deleted from disk, physical copies only un-recorded. ${stays}`;
  }

  return {
    heading,
    copy,
    action: empty
      ? "Delete record"
      : total
        ? "Delete book"
        : `Delete ${noun(count)}`,
    losses: total ? losses(manifest.impact) : [],
    empty,
  };
}

const EXCERPT_CHARS = 170;
const COLLAPSE_CHARS = 900;
const COLLAPSE_LINES = 12;
const SPOILER_MASK = "███";

/** The stop's kicker: how many entries from how many readers, and the reader's own drafts apart from them. */
export function marqueeJournalKicker(
  published: number,
  readers: number,
  drafts: number,
): string {
  if (published + drafts === 0) return "No entries yet";
  const entries = `${published} ${published === 1 ? "entry" : "entries"}`;
  const from = `${entries} from ${readers} ${readers === 1 ? "reader" : "readers"}`;
  return drafts > 0
    ? `${from} · ${drafts} ${drafts === 1 ? "draft" : "drafts"}`
    : from;
}

/**
 * The first non-empty line of a markdown body, markup stripped and spoilers masked
 * (the row is always visible), cut at 170 characters.
 */
export function journalExcerpt(md: string): string {
  const line =
    md
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  const masked = line
    .split("||")
    .map((part, i) => (i % 2 === 0 ? part : SPOILER_MASK))
    .join("");
  const stripped = masked
    .replace(/[*_>#`]/g, "")
    .replace(/^(?:- )+/, "")
    .trim();
  const chars = Array.from(stripped);
  return chars.length > EXCERPT_CHARS
    ? `${chars.slice(0, EXCERPT_CHARS).join("")}…`
    : stripped;
}

/** Whether an entry runs long enough, past 900 characters or 12 lines, to open collapsed. */
export function isLongEntry(md: string): boolean {
  // A trailing newline ends the last line rather than starting another.
  const lines = md.split(/\r?\n/).length - (md.endsWith("\n") ? 1 : 0);
  return (
    Array.from(md.trim()).length > COLLAPSE_CHARS || lines > COLLAPSE_LINES
  );
}

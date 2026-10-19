import type { Book } from "../../api";

/** `book` dropped when `picked` already holds it, appended otherwise. */
export function toggled(picked: readonly Book[], book: Book): Book[] {
  const rest = picked.filter((b) => b.uuid !== book.uuid);
  return rest.length === picked.length ? [...picked, book] : rest;
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

type StatusState = {
  searching: boolean;
  reviewing: boolean;
  pickCount: number;
  /** The answer isn't in yet, so any count would be a claim. */
  pending: boolean;
  shown: number;
  /** The server's own count, or `null` when it didn't say. */
  total: number | null;
};

/** The line above the grid: how much the server holds, or what is picked. */
export function statusLine(s: StatusState): string {
  if (s.reviewing) return count(s.pickCount, "book picked", "books picked");
  if (s.pending) return s.searching ? "Searching…" : "Counting…";
  const [one, many] = s.searching ? ["match", "matches"] : ["book", "books"];
  // Without a total, say only what is on screen: never imply it is the whole library.
  if (s.total === null) return count(s.shown, one, many);
  // A search is capped server-side with no cursor, so it names the shortfall.
  if (!s.searching || s.total <= s.shown) return count(s.total, one, many);
  return `Showing ${s.shown} of ${count(s.total, one, many)} · narrow your search`;
}

/** Why the grid is empty, in the reader's terms. */
export function emptyMessage(s: {
  reviewing: boolean;
  searching: boolean;
  query: string;
}): string {
  if (s.reviewing) return "Nothing picked yet.";
  if (s.searching) return `No books match “${s.query}”.`;
  return "No books in your library yet.";
}

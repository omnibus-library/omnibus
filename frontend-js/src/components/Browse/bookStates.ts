import type { Book, BookState } from "../../api";
import { bookCount, unitsAgo } from "../../format";

/** The reader's state on each of a page's books, by book uuid. */
export type BookStates = ReadonlyMap<string, BookState>;

const DAY = 86_400;

export type Tally = { finished: number; reading: number; unread: number };

/** Finished, reading and unread counts over `books`; a book with no state is unread. */
export function tally(books: readonly Book[], states: BookStates): Tally {
  const counts: Tally = { finished: 0, reading: 0, unread: 0 };
  for (const book of books) {
    counts[states.get(book.uuid)?.status ?? "unread"]++;
  }
  return counts;
}

/** The book in progress the reader touched last. */
export function currentBook<B extends Book>(
  books: readonly B[],
  states: BookStates,
) {
  let best: { book: B; state: BookState } | null = null;
  for (const book of books) {
    const state = states.get(book.uuid);
    if (state?.status !== "reading") continue;
    // Later books win a tie, as `Iterator::max_by_key` does in the Dioxus page.
    if (!best || (state.lastReadAt ?? -1) >= (best.state.lastReadAt ?? -1)) {
      best = { book, state };
    }
  }
  return best;
}

/** "today", "yesterday", "3 days ago", "5 weeks ago", "2 years ago": calendar days in the reader's zone (`zoneSecs` east of UTC). */
export function readAgo(now: number, then: number, zoneSecs: number): string {
  const day = (at: number) => Math.floor((at + zoneSecs) / DAY);
  const days = Math.max(0, day(now) - day(then));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return unitsAgo(days, "day");
  if (days < 60) return unitsAgo(Math.floor(days / 7), "week");
  if (days < 730) return unitsAgo(Math.floor(days / 30), "month");
  return unitsAgo(Math.floor(days / 365), "year");
}

/** "6 books · 1 finished", leaving out none finished. */
export function shelfMeta(books: readonly Book[], states: BookStates): string {
  const { finished } = tally(books, states);
  const count = bookCount(books.length);
  return finished === 0 ? count : `${count} · ${finished} finished`;
}

/** A tile's bar width in percent: full when finished, the percent (at least a sliver) in progress, none unread. */
export function tileBar(state: BookState | undefined): number | null {
  if (state?.status === "finished") return 100;
  if (state?.status === "reading") {
    return Math.min(Math.max(state.percent ?? 0, 3), 100);
  }
  return null;
}

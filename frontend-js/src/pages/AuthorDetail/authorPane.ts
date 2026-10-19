import type { Book, BookState, SeriesId } from "../../api";
import { bookCount, unitsAgo } from "../../format";

/** The reader's state on each of an author's books, by book uuid. */
export type BookStates = ReadonlyMap<string, BookState>;

const DAY = 86_400;

/** Finished, reading and unread counts over `books`; a book with no state is unread. */
export function tally(books: readonly Book[], states: BookStates) {
  const counts = { finished: 0, reading: 0, unread: 0 };
  for (const book of books) {
    counts[states.get(book.uuid)?.status ?? "unread"]++;
  }
  return counts;
}

/** The book in progress the reader touched last. */
export function currentBook(books: readonly Book[], states: BookStates) {
  let best: { book: Book; state: BookState } | null = null;
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

/** The meta line under the current book, "Earthsea 2 · 42% · read 3 days ago", each part dropped when unknown. */
export function currentMeta(
  book: Book,
  state: BookState,
  now: number,
  zoneSecs: number,
): string {
  const series = book.series
    ? [book.series.name, book.series.index].filter(Boolean).join(" ")
    : null;
  return [
    series,
    state.percent === null ? null : `${state.percent}%`,
    state.lastReadAt === null
      ? null
      : `read ${readAgo(now, state.lastReadAt, zoneSecs)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** One series' books, in the order the author read returned them. */
export type SeriesShelf = {
  name: string;
  /** `null` for a series name with no `series` row behind it (no page to open). */
  id: SeriesId | null;
  books: Book[];
};

/** Groups books by series in first-seen order, standalones apart. */
export function groupBySeries(books: readonly Book[]) {
  const shelves = new Map<string, SeriesShelf>();
  const standalone: Book[] = [];
  for (const book of books) {
    if (!book.series) {
      standalone.push(book);
      continue;
    }
    const { name } = book.series;
    const shelf = shelves.get(name);
    if (shelf) shelf.books.push(book);
    else shelves.set(name, { name, id: book.seriesId, books: [book] });
  }
  return { shelves: [...shelves.values()], standalone };
}

/** How many distinct series `books` span. */
export const seriesCount = (books: readonly Book[]) =>
  new Set(books.flatMap((b) => (b.series ? [b.series.name] : []))).size;

/** "6 books · 1 finished", leaving out none finished. */
export function shelfMeta(books: readonly Book[], states: BookStates): string {
  const { finished } = tally(books, states);
  const count = bookCount(books.length);
  return finished === 0 ? count : `${count} · ${finished} finished`;
}

/** "11 books · 2 series", leaving out a zero series count. */
export function heroMeta(books: number, series: number): string {
  return series === 0
    ? bookCount(books)
    : `${bookCount(books)} · ${series} series`;
}

/** A tile's bar width in percent: full when finished, the percent (at least a sliver) in progress, none unread. */
export function tileBar(state: BookState | undefined): number | null {
  if (state?.status === "finished") return 100;
  if (state?.status === "reading") {
    return Math.min(Math.max(state.percent ?? 0, 3), 100);
  }
  return null;
}

import type { Book, BookState, SeriesId } from "../../api";
import { readAgo } from "../../components/Browse/bookStates";
import { bookCount } from "../../format";

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

/** "11 books · 2 series", leaving out a zero series count. */
export function heroMeta(books: number, series: number): string {
  return series === 0
    ? bookCount(books)
    : `${bookCount(books)} · ${series} series`;
}

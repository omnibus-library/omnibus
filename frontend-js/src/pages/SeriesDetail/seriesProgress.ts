import type { AuthorId, Book, BookState, SeriesBook } from "../../api";
import {
  type BookStates,
  currentBook,
  readAgo,
} from "../../components/Browse/bookStates";
import { formatYear } from "../../format";
import { readerHref } from "../../resume";

/** Highest number `missingNumbers` looks for gaps below; a series numbered by year or issue past it isn't a run a reader collects book by book. */
export const MAX_GAP_SCAN = 200;

// What Rust's `f64::from_str` accepts, which the Dioxus page parses an index with.
const F64 = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The book the reading strip offers next. */
export type NextUp =
  | { kind: "resume"; book: SeriesBook; state: BookState }
  | {
      kind: "start";
      book: SeriesBook;
      /** Set when the book was marked unread with a position kept. */
      state: BookState | null;
      /** The reader has started none of the series. */
      fresh: boolean;
    };

export type NextAction = {
  label: "Resume" | "Start";
  to: string;
  testid: "series-current" | "series-next";
  actionTestid: "series-resume" | "series-start";
};

// A kept position makes Start say Resume and "Start here" say "Up next".
const kept = (state: BookState | null) => state?.format != null;

const bookNumber = (book: Book) =>
  book.series?.index == null ? null : `Book ${book.series.index}`;

/** The book in progress, else the first unread in reading order; `null` once every book is finished. */
export function nextUp(
  books: readonly SeriesBook[],
  states: BookStates,
): NextUp | null {
  const current = currentBook(books, states);
  if (current) return { kind: "resume", ...current };
  const statusOf = (book: SeriesBook) =>
    states.get(book.uuid)?.status ?? "unread";
  const book = books.find((b) => statusOf(b) === "unread");
  if (!book) return null;
  return {
    kind: "start",
    book,
    state: states.get(book.uuid) ?? null,
    fresh: books.every((b) => statusOf(b) === "unread"),
  };
}

/** "Book 3 · 42% · read 3 days ago" to resume, "Up next · Book 4" or "Start here · Book 1" to start; each part dropped when unknown. */
export function nextMeta(next: NextUp, now: number, zoneSecs: number): string {
  const percent = (state: BookState | null) =>
    state?.percent == null ? null : `${state.percent}%`;
  const parts =
    next.kind === "resume"
      ? [
          bookNumber(next.book),
          percent(next.state),
          next.state.lastReadAt === null
            ? null
            : `read ${readAgo(now, next.state.lastReadAt, zoneSecs)}`,
        ]
      : [
          next.fresh && !kept(next.state) ? "Start here" : "Up next",
          bookNumber(next.book),
          percent(next.state),
        ];
  return parts.filter((part) => part !== null).join(" · ");
}

/** Resume for the book in progress and for an unread one with a position kept, else Start; where it opens and the card's test ids. */
export function nextAction(next: NextUp): NextAction {
  const resume = next.kind === "resume" || kept(next.state);
  return {
    label: resume ? "Resume" : "Start",
    to: readerHref(
      next.book.uuid,
      next.book.formats,
      next.state?.format ?? null,
      next.state?.fileId ?? null,
    ),
    testid: next.kind === "resume" ? "series-current" : "series-next",
    actionTestid: resume ? "series-resume" : "series-start",
  };
}

/** Each book's first author, in reading order without repeats; a credited translator or editor isn't who the series is by. */
export function seriesAuthors(
  books: readonly SeriesBook[],
): { name: string; id: AuthorId | null }[] {
  const authors: { name: string; id: AuthorId | null }[] = [];
  for (const book of books) {
    const first = book.creators.find(
      (c) => c.role === null || c.role === "aut",
    );
    if (first && authors.every((a) => a.name !== first.name)) {
      authors.push({ name: first.name, id: first.id });
    }
  }
  return authors;
}

/** A cover's caption, "Book 1 · 2016"; only a real year counts, so a sentinel date drops the whole slot. */
export function tileCaption(book: Book): string | null {
  const year = book.published ? formatYear(book.published) : null;
  return (
    [bookNumber(book), year].filter((part) => part !== null).join(" · ") || null
  );
}

/** The whole numbers from 1 to the highest whole series number held that no book carries; fractional numbers neither count nor fill a gap. */
export function missingNumbers(books: readonly Book[]): number[] {
  const held = new Set<number>();
  for (const book of books) {
    const raw = book.series?.index?.trim() ?? "";
    const n = F64.test(raw) ? Number(raw) : 0;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_GAP_SCAN) held.add(n);
  }
  const top = Math.max(0, ...held);
  return Array.from({ length: top - 1 }, (_, i) => i + 1).filter(
    (n) => !held.has(n),
  );
}

/** "Not in your library: #4, #6–8", runs collapsed; `null` without a gap. */
export function missingLabel(missing: readonly number[]): string | null {
  const runs: [number, number][] = [];
  for (const n of missing) {
    const last = runs.at(-1);
    if (last && last[1] + 1 === n) last[1] = n;
    else runs.push([n, n]);
  }
  if (runs.length === 0) return null;
  const spans = runs.map(([a, b]) => (a === b ? `#${a}` : `#${a}–${b}`));
  return `Not in your library: ${spans.join(", ")}`;
}

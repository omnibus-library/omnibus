import type { StatsSummary } from "../../api";
import { plural } from "../../format";
import { civilFromDays, dayNumber, monthAbbr } from "./calendar";
import { formatActiveTime } from "./summary";

export type Row = { label: string; headline: string; detail: string };

type Book = NonNullable<StatsSummary["superlatives"]["longest_book"]>;

/** A `YYYY-MM-DD` as "14 Nov 2023". A malformed day comes back unchanged, which labels its figure better than nothing. */
export function prettyDay(day: string): string {
  const days = dayNumber(day);
  if (days === null) return day;
  const [y, m, d] = civilFromDays(days);
  return `${d} ${monthAbbr(m)} ${y}`;
}

/** A length as "412 pages" or "1 page". The unit belongs to the row, so `value` is a bare number. */
export const pagesDetail = (pages: number) => `${pages} page${plural(pages)}`;

/** A span as "in 3 days" or "in a day", since the server collapses a same-day read to 1. */
export const daysDetail = (days: number) =>
  days === 1 ? "in a day" : `in ${days} days`;

function bookRow(
  label: string,
  book: Book | null,
  detail: (value: number) => string,
): Row[] {
  return book
    ? [{ label, headline: book.title, detail: detail(book.value) }]
    : [];
}

/** The top of a ranking the server already sent; a zero-second leader isn't a superlative. */
function rankedRow(label: string, ranked: StatsSummary["top_authors"]): Row[] {
  const top = ranked[0];
  return top && top.seconds > 0
    ? [{ label, headline: top.name, detail: formatActiveTime(top.seconds) }]
    : [];
}

/** Every superlative the window supports, in reading order: book lengths, then the time-shaped ones, then the two rankings. */
export function buildRows(
  summary: Pick<
    StatsSummary,
    | "superlatives"
    | "busiest_week_start"
    | "busiest_week_seconds"
    | "top_authors"
    | "top_tags"
  >,
): Row[] {
  const s = summary.superlatives;
  const week = summary.busiest_week_start;
  return [
    ...bookRow("Longest book", s.longest_book, pagesDetail),
    ...bookRow("Shortest book", s.shortest_book, pagesDetail),
    ...bookRow("Fastest read", s.fastest_read, daysDetail),
    ...bookRow("Longest sitting", s.longest_sit, formatActiveTime),
    ...(s.biggest_day
      ? [
          {
            label: "Biggest day",
            headline: prettyDay(s.biggest_day.day),
            detail: formatActiveTime(s.biggest_day.seconds),
          },
        ]
      : []),
    ...(week && summary.busiest_week_seconds > 0
      ? [
          {
            label: "Busiest week",
            headline: `Week of ${prettyDay(week)}`,
            detail: formatActiveTime(summary.busiest_week_seconds),
          },
        ]
      : []),
    ...rankedRow("Most-read author", summary.top_authors),
    ...rankedRow("Most-read subject", summary.top_tags),
  ];
}

// 1800 mirrors `FASTEST_READ_MIN_SECS` in shared/src/stats.rs.
export const FASTEST_READ_NOTE = `Fastest read counts days from your first tracked session, over books with at least ${formatActiveTime(1800)} of recorded time — reading done before tracking, or on a device that reports nothing, can only make a book look faster than it was.`;

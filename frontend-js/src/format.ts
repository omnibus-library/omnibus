import type { BookDetail } from "./api";

/** The cover plate's author line: the first author's surname, uppercased. */
export function plateAuthor(authors: readonly string[]): string {
  const first = authors[0]?.split(",")[0] ?? "";
  return (first.trim().split(/\s+/).pop() ?? "").toUpperCase();
}

// By code point, not UTF-16 unit, so an emoji is never split in half.
const firstChars = (text: string, n: number) =>
  Array.from(text).slice(0, n).join("");

/** The monogram an avatar shows when the reader has no photo. */
export function initialsFor(name: string): string {
  const [first, second] = name.split(/[\s._-]+/).filter(Boolean);
  if (!first) return "?";
  const picked = second
    ? firstChars(first, 1) + firstChars(second, 1)
    : firstChars(first, 2);
  return picked.toUpperCase();
}

/** The one-letter plate a result shows in place of a cover or photo. */
export function initialOf(name: string): string {
  return firstChars(name, 1).toUpperCase() || "?";
}

/** The plural suffix for `n` of something: "1 book", "2 books". */
export const plural = (n: number) => (n === 1 ? "" : "s");

/**
 * The detail kicker: the series name (to link) and what follows it, or just the
 * tail for a standalone, which leads with its category.
 */
export function homeKicker(book: BookDetail, seriesTotal: number | null) {
  const year = book.published ? formatYear(book.published) : null;
  const yearTail = year ? ` · ${year}` : "";
  if (book.series) {
    const { name, index } = book.series;
    // The index is the book's place in the series and the count is how many the
    // library holds: two unrelated numbers, never "Book 2 of 1".
    const position = index
      ? ` · Book ${index}${seriesTotal ? ` · ${seriesTotal} in your library` : ""}`
      : "";
    return { series: name, tail: position + yearTail };
  }
  const lead = book.genres[0] ?? book.subjects[0] ?? "Book";
  return { series: null, tail: `${lead} · standalone${yearTail}` };
}

const DESCRIPTION_CLAMP_WORDS = 50;

/** Whether a description runs past the clamp and needs a Show more toggle. */
export function descriptionOverflows(html: string): boolean {
  const words = html
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > DESCRIPTION_CLAMP_WORDS;
}

/** The query that narrows search to one tag or genre: `tag:"Dark academia"`. */
export function facetQuery(prefix: "tag" | "genre", value: string): string {
  const trimmed = value.trim();
  // Quoted, a multi-word name stays one facet and a quote inside it is escaped.
  if (/[\s"]/.test(trimmed)) {
    return `${prefix}:"${trimmed.replaceAll('"', '""')}"`;
  }
  return `${prefix}:${trimmed}`;
}

const FACET_PREFIXES = ["author", "series", "tag", "genre"];

/** The name behind a query that is exactly one facet, else `null`. */
export function singleFacetValue(query: string): string | null {
  const q = query.trim();
  const colon = q.indexOf(":");
  const prefix = q.slice(0, colon).toLowerCase();
  if (colon < 0 || !FACET_PREFIXES.includes(prefix)) return null;
  const rest = q.slice(colon + 1);
  if (rest.startsWith('"')) {
    // Quoted: it must close on the last character, or more follows the facet.
    if (rest.length < 2 || !rest.endsWith('"')) return null;
    return rest.slice(1, -1).replaceAll('""', '"') || null;
  }
  return rest.split(/\s+/).filter(Boolean).length === 1 ? rest : null;
}

// Calibre's "no publish date" is 0101-01-01; no real book is that old.
const SENTINEL_YEAR_MAX = 101;

/** The year a stored date names, or `null` when it names none. */
export function formatYear(raw: string): string | null {
  const lead = raw.trim().split(/[T -]/)[0] ?? "";
  const year = /^\d+$/.test(lead) ? Number(lead) : 0;
  return year > SENTINEL_YEAR_MAX ? String(year) : null;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10 < 4 ? day % 10 : 0]}`;
}

function shortDate(
  year: number,
  month: number | null,
  day: number | null,
): string | null {
  if (year <= SENTINEL_YEAR_MAX) return null;
  const name = month ? MONTHS[month - 1] : undefined;
  if (!name) return String(year);
  return day ? `${name} ${ordinal(day)}, ${year}` : `${name} ${year}`;
}

/** A stored date as the reader sees it, `Mar 1st, 2021`, narrowing to month or year; `null` when it names no real year. */
export function formatDateShort(raw: string): string | null {
  const [year, month, day] = (raw.trim().split(/[T ]/)[0] ?? "")
    .split("-")
    .map(Number);
  if (year === undefined || Number.isNaN(year)) return null;
  const validDay = day !== undefined && day >= 1 && day <= 31 ? day : null;
  return shortDate(year, month || null, validDay);
}

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * `formatDateShort` for a stored instant, on the calendar of `timeZone` (the
 * reader's by default). A publication date has no zone and keeps `formatDateShort`.
 */
export function formatInstantShort(
  raw: string,
  timeZone?: string,
): string | null {
  const m = INSTANT.exec(raw.trim());
  const when =
    m && new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`);
  if (!when || Number.isNaN(when.getTime())) return formatDateShort(raw);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(when);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return shortDate(part("year"), part("month"), part("day"));
}

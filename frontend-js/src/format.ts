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

/** The detail kicker: series and position, else the category, then the year. */
export function homeKicker(book: BookDetail): string {
  const year = book.published?.match(/^\d{4}/)?.[0];
  const yearTail = year ? ` · ${year}` : "";
  if (book.series) {
    const position = book.series.index ? ` · Book ${book.series.index}` : "";
    return `${book.series.name}${position}${yearTail}`;
  }
  const lead = book.genres[0] ?? book.subjects[0] ?? "Book";
  return `${lead} · standalone${yearTail}`;
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

import type { BookDetail } from "./api";

/** The cover plate's author line: the first author's surname, uppercased. */
export function plateAuthor(authors: readonly string[]): string {
  const first = authors[0]?.split(",")[0] ?? "";
  return (first.trim().split(/\s+/).pop() ?? "").toUpperCase();
}

/** The monogram an avatar shows when the reader has no photo. */
export function initialsFor(name: string): string {
  const [first, second] = name.split(/[\s._-]+/).filter(Boolean);
  if (!first) return "?";
  const picked = second
    ? first.slice(0, 1) + second.slice(0, 1)
    : first.slice(0, 2);
  return picked.toUpperCase();
}

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

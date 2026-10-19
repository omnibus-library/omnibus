import type { LibrarySize } from "../../api";
import { fixed, plural } from "../../format";
import { groupThousands } from "./summary";

type Measured = LibrarySize["words"];

/** One figure the library supports: the total, its unit, and the coverage line beneath. */
export type Figure = { value: string; unit: string; coverage: string };

type Tiers = readonly (readonly [
  limit: number,
  divisor: number,
  name: string,
])[];

// Each tier opens at 999.5 of the one below rather than at a power of ten: 999,999 rounds to
// 1000 at "K", so it has to promote.
const COMPACT: Tiers = [
  [999.5e6, 1e9, "B"],
  [999.5e3, 1e6, "M"],
  [1e4, 1e3, "K"],
];
const SPELLED: Tiers = [
  [999.5e6, 1e9, "billion"],
  [999.5e3, 1e6, "million"],
  [1e4, 1e3, "thousand"],
];

function scaled(n: number, tiers: Tiers, gap: string): string | null {
  const tier = tiers.find(([limit]) => n >= limit);
  if (!tier) return null;
  const value = n / tier[1];
  return `${fixed(value, value < 100 ? 1 : 0)}${gap}${tier[2]}`;
}

/** A large count in the form a reader can hold, "412M" or "94.2K": a word count's last four digits help nobody. */
export const compact = (n: number) => scaled(n, COMPACT, "") ?? String(n);

/** A count spelled the way a reader would say it, "412 million": "412M" mid-sentence reads as a part number. */
export const spelled = (n: number) =>
  scaled(n, SPELLED, " ") ?? groupThousands(n);

/** Audio length in the unit that fits it, hours below a week and days beyond. The unit follows the rounded figure, or 1h40m reads "2 hour" and a week arrives as "168 hours". */
export function audioValue(seconds: number): { value: string; unit: string } {
  const hours = seconds / 3600;
  const whole = Math.round(hours);
  if (whole < 168) {
    return { value: String(whole), unit: whole === 1 ? "hour" : "hours" };
  }
  return { value: fixed(hours / 24, 0), unit: "days" };
}

/** "across 1,204 of 1,510 books": the denominator, always, as a figure without it is a guess wearing a number. */
export const coverage = (measured: Measured, libraryBooks: number) =>
  `across ${groupThousands(measured.books)} of ${groupThousands(libraryBooks)} book${plural(libraryBooks)}`;

/** Whether nothing in the library has been measured for this figure. */
const unmeasured = (measured: Measured) => measured.books === 0;

/** The figures the library supports, skipping any nothing has been measured for: "0 words" would describe a library that doesn't exist. */
export function buildFigures(size: LibrarySize): Figure[] {
  const figures: Figure[] = [];
  if (!unmeasured(size.words)) {
    figures.push({
      value: compact(size.words.total),
      unit: "words",
      coverage: coverage(size.words, size.books),
    });
  }
  if (!unmeasured(size.pages)) {
    figures.push({
      value: compact(size.pages.total),
      unit: "est. pages",
      coverage: coverage(size.pages, size.books),
    });
  }
  if (!unmeasured(size.listening_seconds)) {
    figures.push({
      ...audioValue(size.listening_seconds.total),
      coverage: coverage(size.listening_seconds, size.books),
    });
  }
  return figures;
}

/** The hero's opening sentence, split so the middle clause can be tinted. It says nothing of how long the shelf would take to read: that is the reader's pace, and this scope isn't the reader's. */
export function heroSentence(size: Pick<LibrarySize, "books" | "words">) {
  const books = `${groupThousands(size.books)} book${plural(size.books)}.`;
  if (unmeasured(size.words)) return { books, words: null, tail: "" };
  return {
    books,
    words: `${spelled(size.words.total)} words`,
    tail: " waiting on the shelf.",
  };
}

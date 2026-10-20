import type { ResumePoint, StatsSummary } from "../../api";
import { yearFraction } from "./calendar";

/** How far into the year the projection is withheld, since one book by the 5th of January would project seventy-three. */
const PROJECTION_MIN_FRACTION = 0.15;

/** How many open books the card lists; the page asks for one more, which is how the card knows it is showing only some. */
export const IN_PROGRESS_SHOWN = 3;

/** Finished books so far this calendar year off the trailing-12 series, which always ends at the current month, so the year prefix is exact. */
export const booksThisYear = (
  months: StatsSummary["books_per_month"],
  year: string,
) =>
  months
    .filter((m) => m.month.startsWith(year))
    .reduce((total, m) => total + m.books, 0);

/** The count this year's pace reaches by 31 December, or `null` when it is too early for the extrapolation to mean anything. */
export function yearProjection(
  summary: Pick<StatsSummary, "as_of_day" | "books_per_month">,
): number | null {
  const fraction = yearFraction(summary.as_of_day);
  if (fraction === null || fraction < PROJECTION_MIN_FRACTION) return null;
  const finished = booksThisYear(
    summary.books_per_month,
    summary.as_of_day.slice(0, 4),
  );
  return finished > 0 ? Math.round(finished / fraction) : null;
}

type Position = Pick<
  ResumePoint,
  "percent" | "chapter" | "chaptersTotal" | "part" | "partCount"
>;

/**
 * An open book's readout: a whole-book percent when it can report one, else its structural position.
 * A book that can say neither says nothing rather than inventing a zero.
 */
export function resumeReadout(point: Position): string | null {
  if (point.percent !== null) return `${point.percent}%`;
  // A resolved chapter outranks the part even when it has no total to read out.
  if (point.chapter !== null) {
    return point.chaptersTotal === null
      ? null
      : `Ch ${point.chapter} of ${point.chaptersTotal}`;
  }
  return point.part !== null && point.partCount !== null
    ? `Pt ${point.part} of ${point.partCount}`
    : null;
}

/** The bar width the readout's percent states, and nothing for a book that can't report one. */
export const resumePercent = ({ percent }: Pick<ResumePoint, "percent">) =>
  Math.min(Math.max(percent ?? 0, 0), 100);

/** The line under a list cut to `IN_PROGRESS_SHOWN`, or `null` when it is every open book there is. */
export const moreOpenNote = (fetched: number) =>
  fetched > IN_PROGRESS_SHOWN
    ? `Showing the ${IN_PROGRESS_SHOWN} most recently opened.`
    : null;

/** A rating as the 0 to 5 value the star row draws, halves kept; `null` for an unrated book. */
export const clampedStars = (rating: number | null | undefined) =>
  typeof rating === "number" ? Math.min(Math.max(rating, 0), 5) : null;

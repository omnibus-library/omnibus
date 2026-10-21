/** The anchor a comic page is saved under, the same string iOS and the Dioxus pager read. */
export const comicPageAnchor = (page: number) => `comic-page:${page}`;

/** The 0-based page a `comic-page:N` anchor names; `null` for anything else, a CFI included. */
export function parseComicPageAnchor(anchor: string): number | null {
  const match = /^comic-page:(\d+)$/.exec(anchor);
  return match ? Number(match[1]) : null;
}

/** Whole-book percent for a 0-based `page` of `count`; the last page reads 100. */
export const pagePercent = (page: number, count: number) =>
  count === 0 ? 0 : Math.round(((page + 1) * 100) / count);

/** The 0-based page a whole-book percent resumes at: the inverse of `pagePercent`, within rounding. */
export function pageFromPercent(percent: number, count: number) {
  const approx = Math.round(
    (Math.min(Math.max(percent, 0), 100) / 100) * count,
  );
  return Math.min(Math.max(approx - 1, 0), count - 1);
}

/**
 * The page a saved position resumes at: the exact anchor, else the percent, else page 0.
 * Clamped so a shrunken re-scan of the archive can't land out of range.
 */
export function comicStartPage(
  anchor: string | null,
  percent: number | null,
  count: number,
): number {
  if (count === 0) return 0;
  const page = anchor === null ? null : parseComicPageAnchor(anchor);
  if (page !== null) return Math.min(page, count - 1);
  return percent === null ? 0 : pageFromPercent(percent, count);
}

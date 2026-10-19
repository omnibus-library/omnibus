import { pageFromPercent } from "../ComicReader/pager";

/** The anchor a PDF page is saved under, the same string iOS's PDFKit reader reads. */
export const pdfPageAnchor = (page: number) => `pdf-page:${page}`;

/** The 0-based page a `pdf-page:N` anchor names; `null` for a comic anchor, a CFI or a highlight's `pdf:`. */
export function parsePdfPageAnchor(anchor: string): number | null {
  const match = /^pdf-page:(\d+)$/.exec(anchor);
  return match ? Number(match[1]) : null;
}

/** The 0-based page a 1-based `?page=` names; `null` for zero, a negative or anything unparseable, which resume instead. */
export function deepLinkPage(raw: string | null): number | null {
  const page = raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : 0;
  return page >= 1 ? page - 1 : null;
}

/**
 * The 0-based page the reader opens on: a deep link (landing there is its whole point), else
 * the saved anchor, else the inverse of the saved percent, else page 0. Clamped once the page
 * count is known; the glue clamps again against PDF.js's own.
 */
export function pdfStartPage(
  deepLink: number | null,
  anchor: string | null,
  percent: number | null,
  count: number,
): number {
  const clamp = (page: number) =>
    count === 0 ? page : Math.min(page, count - 1);
  if (deepLink !== null) return clamp(deepLink);
  const saved = anchor === null ? null : parsePdfPageAnchor(anchor);
  if (saved !== null) return clamp(saved);
  return percent !== null && count > 0 ? pageFromPercent(percent, count) : 0;
}

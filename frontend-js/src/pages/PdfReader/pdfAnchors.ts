import type { Highlight, HighlightColor } from "../../api";
import { MAX_QUADS, pdfAnchorPage } from "../BookDetail/highlights";
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

/** The 0-based page the reader opens on; clamped to the indexed count, which the glue clamps again against PDF.js's own. */
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

/**
 * The anchor a highlight is stored under: `pdf:{page}:{x1,y1,…,x4,y4};…` at one decimal, the
 * string iOS's PDFKit reader parses. No quads, or more than the cap, names the page alone.
 */
export function encodePdfAnchor(
  page: number,
  quads: readonly (readonly number[])[],
): string {
  if (quads.length === 0 || quads.length > MAX_QUADS) return `pdf:${page}`;
  const encoded = quads.map((quad) => quad.map((n) => n.toFixed(1)).join(","));
  return `pdf:${page}:${encoded.join(";")}`;
}

/** The highlights the glue can place: EPUB CFIs and anchorless Kobo rows are left out, not handed to a painter that can't read them. */
export function paintList(
  highlights: readonly Highlight[],
): { anchor: string; color: HighlightColor }[] {
  return highlights.flatMap(({ anchor, color }) =>
    anchor?.startsWith("pdf:") && pdfAnchorPage(anchor) !== null
      ? [{ anchor, color }]
      : [],
  );
}

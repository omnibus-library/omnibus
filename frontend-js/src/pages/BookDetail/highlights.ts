import {
  type Chapter,
  cfiSpineOrdinal,
  chapterIndexForCfi,
  lastIndexWhere,
} from "./readout";

const MAX_QUADS = 60;

const isQuad = (quad: string) => {
  const nums = quad.split(",").map((n) => Number(n.trim()));
  return nums.length === 8 && nums.every(Number.isFinite);
};

/**
 * The 0-based page a PDF anchor names: a position anchor (`pdf-page:N`) or a
 * highlight anchor (`pdf:N` or `pdf:N:quads`). `null` for anything else, such as a CFI.
 */
export function pdfAnchorPage(anchor: string): number | null {
  const position = /^pdf-page:(\d+)$/.exec(anchor);
  if (position) return Number(position[1]);
  const match = /^pdf:(\d+)(?::(.*))?$/.exec(anchor);
  if (!match) return null;
  const quads = match[2] ? match[2].split(";") : [];
  return quads.length <= MAX_QUADS && quads.every(isQuad)
    ? Number(match[1])
    : null;
}

const titled = (chapter: Chapter | undefined) => chapter?.title.trim() || null;

/**
 * Where a passage sits, as the reader names it: the chapter's title (a TOC counts
 * front matter, so its ordinal would disagree), else "Section N" or "Page N".
 * `null` when the anchor has no readable position.
 */
export function highlightLocator(
  anchor: string,
  chapters: readonly Chapter[],
): string | null {
  const page = pdfAnchorPage(anchor);
  if (page !== null) {
    // A PDF's structure holds one entry per page, so an entry's spine index is its page.
    return (
      titled(chapters[lastIndexWhere(chapters, (c) => c.spineIndex <= page)]) ??
      `Page ${page + 1}`
    );
  }
  const at = chapterIndexForCfi(chapters, anchor);
  const title = at === null ? null : titled(chapters[at]);
  if (title) return title;
  const section = cfiSpineOrdinal(anchor);
  return section === null ? null : `Section ${section}`;
}

/**
 * The reader URL that opens a book at a passage. Each reader prefers its deep link
 * over saved progress: the EPUB reader takes `?cfi=`, the PDF reader a 1-based `?page=`.
 */
export function readerDeepLink(bookUuid: string, anchor: string): string {
  const page = pdfAnchorPage(anchor);
  const uuid = encodeURIComponent(bookUuid);
  if (page !== null) return `/pdf/${uuid}?page=${page + 1}`;
  return `/read/${uuid}?${new URLSearchParams({ cfi: anchor })}`;
}

/** The section kicker: "No saved passages", "1 saved passage", "4 saved passages". */
export function passagesKicker(count: number): string {
  if (count === 0) return "No saved passages";
  return `${count} saved passage${count === 1 ? "" : "s"}`;
}

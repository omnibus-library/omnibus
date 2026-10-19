import type { Relocate, TocEntry } from "./epubGlue";

/** `navFailed` is a jump the glue couldn't land: the page stays readable under a notice. */
export type ReaderStatus = "loading" | "ready" | "failed" | "navFailed";

/** Applies a state from the glue; a late nav-error never replaces the load-error surface. */
export function applyGlueStatus(
  current: ReaderStatus,
  state: string,
): ReaderStatus {
  switch (state) {
    case "ready":
      return "ready";
    case "error":
      return "failed";
    case "nav-error":
      return current === "failed" ? current : "navFailed";
    default:
      return "loading";
  }
}

/** Whether a landed relocate clears the status to `ready`; never `failed`, so a stray one can't hide the load error. */
export const clearedByRelocate = (status: ReaderStatus) =>
  status === "loading" || status === "navFailed";

/** What a relocate writes; compares against the last *posted* cfi, since the glue's locations-ready re-emit is an echo that would swallow a turn's write. */
export function relocateWrite(
  cfi: string | null,
  echo: boolean,
  lastPosted: string | null,
  hold: boolean,
): { post: string | null; lastPosted: string | null; hold: boolean } {
  if (!cfi || echo || cfi === lastPosted)
    return { post: null, lastPosted, hold };
  return { post: hold ? null : cfi, lastPosted: cfi, hold: false };
}

/** The chapter number and total from the flat TOC's own order, not the glue's pair; carries the previous chapter when the title matches no entry. */
export function resolveChapterPosition(
  toc: readonly TocEntry[],
  incoming: Pick<Relocate, "chapter" | "totalChapters" | "chapterTitle">,
  previousChapter: number,
): [chapter: number, total: number] {
  let chapter = incoming.chapter;
  let total = incoming.totalChapters;
  if (toc.length > 0) {
    total = toc.length;
    const at = toc.findIndex((entry) => entry.label === incoming.chapterTitle);
    chapter = incoming.chapterTitle === "" || at < 0 ? previousChapter : at + 1;
  }
  return total > 0 ? [Math.max(chapter, 1), total] : [chapter, total];
}

/** The location before the glue's first relocate. */
export const NO_LOCATION: Relocate = {
  cfi: null,
  page: 0,
  totalPages: 0,
  pct: 0,
  frac: 0,
  pctApprox: false,
  atEnd: false,
  chapter: 0,
  totalChapters: 0,
  chapterTitle: "",
  echo: false,
};

type Where = Pick<Relocate, "pct" | "pctApprox">;

// "~N%" while the whole-book locations map is still resolving: honest, not falsely precise.
const pctLabel = (loc: Where) => `${loc.pctApprox ? "~" : ""}${loc.pct}%`;

/** The footer's page and chapter readouts; both empty until the glue has relocated. */
export function formatProgressLabels(
  loc: Pick<Relocate, "page" | "totalPages" | "chapter" | "totalChapters"> &
    Where,
): { page: string; chapter: string } {
  let page = "";
  if (loc.totalPages > 0) {
    page = `p. ${loc.page} of ${loc.totalPages} · ${pctLabel(loc)}`;
  } else if (loc.pct > 0) {
    page = pctLabel(loc);
  }
  const chapter =
    loc.totalChapters > 0 ? `Ch ${loc.chapter} of ${loc.totalChapters}` : "";
  return { page, chapter };
}

/** The phone footer while the chrome is hidden: the bare page number, or the percent before pagination. */
export function formatAmbientPage(
  loc: Pick<Relocate, "page" | "totalPages"> & Where,
): string {
  if (loc.totalPages > 0) return String(loc.page);
  return loc.pct > 0 ? pctLabel(loc) : "";
}

/** The phone top bar's sub-line under the title: "Ch. 3 · 14%". */
export function formatTitleSub(loc: Pick<Relocate, "chapter"> & Where): string {
  if (loc.chapter > 0) return `Ch. ${loc.chapter} · ${pctLabel(loc)}`;
  return loc.pct > 0 ? pctLabel(loc) : "";
}

/** The contents drawer's progress line: "184 / 272 · 68%". */
export function formatContentsProgress(
  loc: Pick<Relocate, "page" | "totalPages"> & Where,
): string {
  return loc.totalPages > 0
    ? `${loc.page} / ${loc.totalPages} · ${pctLabel(loc)}`
    : "";
}

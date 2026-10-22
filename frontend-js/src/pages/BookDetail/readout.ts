import type { Alignment, BookDetail, Position, Progress } from "../../api";
import { formatHm, formatYear, plural } from "../../format";

export type Chapter = NonNullable<Alignment["chapters"]>[number];

export function lastIndexWhere<T>(
  items: readonly T[],
  test: (item: T) => boolean,
): number {
  let found = -1;
  items.forEach((item, i) => {
    if (test(item)) found = i;
  });
  return found;
}

// Spine children are even-numbered (odd steps address text nodes), so a
// CFI's package step halved is the 1-based spine ordinal, e.g. 14 in `/6/14[chap3]!…` is 7.
export function cfiSpineOrdinal(cfi: string): number | null {
  const inner = /^epubcfi\((.*)\)$/.exec(cfi.trim())?.[1];
  const step = inner
    ?.split("!")[0]
    ?.split("/")
    .filter((s) => s !== "")
    .at(-1);
  const raw = step?.split("[")[0];
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n === 0 || n % 2 !== 0 ? null : n / 2;
}

// `/4/2:5` is [4, 2]: each step's leading number, its offset dropped.
function steps(path: string): number[] | null {
  const parsed = path
    .split("/")
    .filter((s) => s !== "")
    .map((s) => /^\d+/.exec(s)?.[0]);
  return parsed.every((s) => s !== undefined) ? parsed.map(Number) : null;
}

// A CFI without its `[…]` assertions, whose text may hold `,` or `/`.
function stripAssertions(cfi: string): string {
  let depth = 0;
  let out = "";
  for (const ch of cfi) {
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

// The steps after the `!`, to the start of a range: `epubcfi(/6/8!/4/2[c1]/10,/1:5,/1:9)` is [4, 2, 10, 1].
function cfiDocSteps(cfi: string): number[] | null {
  const inner = /^epubcfi\((.*)\)$/.exec(cfi.trim())?.[1];
  const doc =
    inner === undefined ? undefined : stripAssertions(inner).split("!")[1];
  if (doc === undefined) return null;
  const [parent, start = ""] = doc.split(",");
  return steps(`${parent}${start}`);
}

const notAfter = (a: number[], b: number[]) => {
  const at = a.findIndex((n, i) => i < b.length && n !== b[i]);
  return at >= 0 ? (a[at] ?? 0) < (b[at] ?? 0) : a.length <= b.length;
};

/**
 * The index of the chapter a CFI sits in, by spine item first, then by its
 * place among the anchors of chapters sharing that item. `null` when the CFI
 * has no readable spine step or sits before the first chapter.
 */
export function chapterIndexForCfi(
  chapters: readonly Chapter[],
  cfi: string,
): number | null {
  const ordinal = cfiSpineOrdinal(cfi);
  if (ordinal === null) return null;
  const spine = ordinal - 1;
  const first = chapters.findIndex((c) => c.spineIndex === spine);
  if (first < 0) {
    const before = lastIndexWhere(chapters, (c) => c.spineIndex <= spine);
    return before < 0 ? null : before;
  }
  const last = lastIndexWhere(chapters, (c) => c.spineIndex === spine);
  const position = cfiDocSteps(cfi);
  if (first === last || !position) return last;
  // A chapter with no anchor recorded counts as opening the item.
  for (let i = last; i > first; i--) {
    const anchor = chapters[i]?.anchorPath;
    const anchorSteps = anchor ? steps(anchor) : null;
    if (
      chapters[i]?.spineIndex === spine &&
      (!anchorSteps || notAfter(anchorSteps, position))
    ) {
      return i;
    }
  }
  return first;
}

const TITLE_CAP = 32;

/** A chapter title cut to a phrase on a word boundary, so a verbose nav can't stretch a button. */
export function shortChapterTitle(title: string): string {
  const t = title.trim();
  const chars = [...t];
  if (chars.length <= TITLE_CAP) return t;
  const head = chars.slice(0, TITLE_CAP).join("");
  const cut = head.search(/\s\S*$/);
  return `${head.slice(0, cut < 0 ? head.length : cut).replace(/[\s—\-,:]+$/, "")}…`;
}

/** The 1-based chapter the reading position is in and its short title, by CFI, else by percent past the start. */
export function chapterNow(
  chapters: readonly Chapter[],
  reading: Position | null,
): { n: number; title: string } | null {
  if (!reading || chapters.length === 0) return null;
  const byCfi = reading.cfi ? chapterIndexForCfi(chapters, reading.cfi) : null;
  const { percent } = reading;
  const at =
    byCfi ??
    (percent && percent > 0
      ? lastIndexWhere(chapters, (c) => c.percent <= percent)
      : -1);
  const chapter = chapters[at];
  return chapter
    ? { n: at + 1, title: shortChapterTitle(chapter.title) }
    : null;
}

/** Where the listening position sits on the whole audio timeline, 0 to 1; `null` when it can't be placed. */
export function listeningFrac(alignment: Alignment): number | null {
  const { listening, audioFiles } = alignment;
  const total = audioFiles.reduce((sum, f) => sum + f.seconds, 0);
  // A file-less position is only unambiguous on a single-file timeline.
  const fileId =
    listening?.fileId ??
    (audioFiles.length === 1 ? audioFiles[0]?.id : undefined);
  if (!listening || total <= 0 || fileId === undefined) return null;
  let start = 0;
  for (const file of audioFiles) {
    if (file.id === fileId) {
      const at = start + Math.min(Math.max(listening.seconds, 0), file.seconds);
      return Math.min(Math.max(at / total, 0), 1);
    }
    start += file.seconds;
  }
  return null;
}

/** A text fraction mapped through the anchor pairs, with (0,0) and (1,1) implied. */
export function interpolatePairs(
  pairs: readonly (readonly [number, number])[],
  fraction: number,
): number {
  const frac = Math.min(Math.max(fraction, 0), 1);
  let prev: readonly [number, number] = [0, 0];
  for (const next of [...pairs, [1, 1] as const]) {
    if (frac <= next[0]) {
      if (Math.abs(next[0] - prev[0]) < Number.EPSILON) return prev[1];
      const k = (frac - prev[0]) / (next[0] - prev[0]);
      return Math.min(Math.max(prev[1] + k * (next[1] - prev[1]), 0), 1);
    }
    prev = next;
  }
  return frac;
}

/** The audio position a linked book is at: the listening position, else the reading one mapped onto the timeline. */
export function linkedAudioAt(alignment: Alignment): string | null {
  const total = alignment.audioFiles.reduce((sum, f) => sum + f.seconds, 0);
  const listened = listeningFrac(alignment);
  if (listened !== null) return formatHm(listened * total);
  const percent = alignment.reading?.percent;
  if (total <= 0 || percent == null) return null;
  return formatHm(
    interpolatePairs(alignment.anchorPairs, percent / 100) * total,
  );
}

export type HomeReadout = {
  chTotal: number | null;
  chNow: { n: number; title: string } | null;
  audioAt: string | null;
  audioTotal: string | null;
  audioLeftSecs: number | null;
};

/** The chapter and timeline facts the resume buttons and the ruler show. */
export function homeReadout(
  alignment: Alignment | undefined,
  reading: Position | null,
): HomeReadout {
  const total =
    alignment?.audioFiles.reduce((sum, f) => sum + f.seconds, 0) ?? 0;
  const frac = alignment ? listeningFrac(alignment) : null;
  return {
    chTotal:
      alignment?.chapters && alignment.chapters.length > 1
        ? alignment.chapters.length
        : null,
    chNow: alignment?.chapters ? chapterNow(alignment.chapters, reading) : null,
    audioAt: frac === null ? null : formatHm(frac * total),
    audioTotal: total > 0 ? formatHm(total) : null,
    audioLeftSecs: frac === null ? null : Math.trunc((1 - frac) * total),
  };
}

/** The whole-book percent from whichever format was saved last. */
export function newestPercent({ reading, listening }: Progress): number | null {
  const [a, b] = [reading, listening].map((p) =>
    p?.percent == null ? null : p,
  );
  if (a && b) return (b.updatedAt > a.updatedAt ? b : a).percent;
  return (a ?? b)?.percent ?? null;
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** A language code as its English name; anything `Intl` can't read stays as it was written. */
function languageName(code: string): string {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The line under the byline, `2014 · Del Rey · 382 pages · English`, without what the record doesn't know. */
export function factLine(
  book: Pick<BookDetail, "published" | "publisher" | "pageCount" | "language">,
): string | null {
  const year = book.published ? formatYear(book.published) : null;
  const parts = [
    year,
    book.publisher?.trim(),
    book.pageCount ? `${book.pageCount} page${plural(book.pageCount)}` : null,
    book.language ? languageName(book.language) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

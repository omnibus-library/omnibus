import type { Chapter } from "../../api";
import { MAX_RATE, MIN_RATE } from "../../playback/boot";

/** `H:MM:SS`, or `M:SS` under an hour; 0:00 for anything that isn't a time. */
export function formatHms(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const [h, m, s] = [
    Math.floor(total / 3600),
    Math.floor((total % 3600) / 60),
    total % 60,
  ];
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The chapter `elapsed` is in: the last one that has started, or the first. */
export function chapterIndexForElapsed(
  chapters: readonly Chapter[],
  elapsed: number,
): number {
  return Math.max(0, chapters.filter((c) => c.start <= elapsed).length - 1);
}

/** "Now playing", with the chapter count once the book has chapters. */
export function kickerText(chapterCount: number, index: number): string {
  return chapterCount > 0
    ? `Now playing · Chapter ${index + 1} of ${chapterCount}`
    : "Now playing";
}

/** The speed on its button: `1.50×`. */
export const rateLabel = (rate: number) => `${rate.toFixed(2)}×`;

/** The chapter title line ("Ch. 2 · The Journey"), or null when the chapter has no title. */
export function chapterSubText(
  chapters: readonly Chapter[],
  index: number,
): string | null {
  const title = chapters[index]?.title;
  return title ? `Ch. ${index + 1} · ${title}` : null;
}

/** Where "previous chapter" goes: this chapter's start past 3 s in, else the one before (0 on the first). Null when `index` is stale. */
export function chapterPrevTarget(
  chapters: readonly Chapter[],
  elapsed: number,
  index: number,
): number | null {
  const current = chapters[index];
  if (!current) return null;
  if (elapsed - current.start > 3) return current.start;
  return chapters[index - 1]?.start ?? 0;
}

/** Where "next chapter" goes: the next chapter's start, or null on the last. */
export const chapterNextTarget = (
  chapters: readonly Chapter[],
  index: number,
): number | null => chapters[index + 1]?.start ?? null;

/** How full chapter segment `i` is: played ones 100, the current one by progress, the rest 0. */
export function chapterFillPct(
  i: number,
  current: number,
  elapsed: number,
  chapter: Chapter,
): number {
  if (i < current) return 100;
  if (i > current || chapter.seconds <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, ((elapsed - chapter.start) / chapter.seconds) * 100),
  );
}

/** The single segment's fill when the book has no chapters. */
export const noChapterFillPct = (elapsed: number, duration: number) =>
  duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

/** The playhead's offset along the bar, kept inside it; 0 when the bar has no length. */
export const thumbPct = (position: number, max: number) =>
  max > 0 ? Math.min(100, Math.max(0, (position / max) * 100)) : 0;

/**
 * What the scrubber's readouts show: the dragged-to position (clamped into the book) while
 * `scrub` is set, else `elapsed`, with the chapter and time left that position implies.
 */
export function effectiveScrubPosition(
  chapters: readonly Chapter[],
  elapsed: number,
  duration: number,
  scrub: number | null,
) {
  const position =
    scrub === null
      ? elapsed
      : Math.min(Math.max(scrub, 0), duration > 0 ? duration : 1);
  return {
    position,
    index: chapterIndexForElapsed(chapters, position),
    remaining: Math.max(duration - position, 0),
  };
}

/** What a bookmark at `seconds` is called: its chapter, numbered and titled when it has a title. */
export function chapterLabelAt(
  seconds: number,
  chapters: readonly Chapter[],
): string {
  if (chapters.length === 0) return "Bookmark";
  const index = chapterIndexForElapsed(chapters, seconds);
  const title = chapters[index]?.title;
  return title ? `Ch. ${index + 1} · ${title}` : `Chapter ${index + 1}`;
}

/** The toolbar's panes, of which at most one is open. */
export type Pane = "speed" | "sleep" | "bookmarks" | "chapters";

/** Wall-clock seconds a listener at `rate` spends on `seconds` of book; unscaled for a rate that can't divide. */
export const remainingAtRate = (seconds: number, rate: number) =>
  Number.isFinite(rate) && rate > 0 ? seconds / rate : seconds;

/** The finest step the speed moves in. */
export const RATE_STEP = 0.05;

/** A speed kept in range and on the 0.05 grid; whole steps divided back out, as step * 0.05 leaks 1.2000000000000002. */
export function clampRate(rate: number): number {
  const steps = 1 / RATE_STEP;
  return (
    Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * steps) / steps
  );
}

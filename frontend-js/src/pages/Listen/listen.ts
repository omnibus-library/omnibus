import type { Chapter } from "../../api";

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

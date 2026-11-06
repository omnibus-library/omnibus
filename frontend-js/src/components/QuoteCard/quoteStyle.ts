/** The card shapes, in the order the editor offers them. */
export const RATIOS = [
  { key: "1:1", name: "Square" },
  { key: "4:5", name: "Post" },
  { key: "3:4", name: "Portrait" },
  { key: "9:16", name: "Story" },
] as const;

export type Ratio = (typeof RATIOS)[number]["key"];

/** The typefaces the editor offers: the token the canvas draws with, the chip label, and the chip's own CSS stack. */
export const FONTS = [
  { key: "serif", label: "Serif", css: "var(--serif)" },
  { key: "sans", label: "Sans", css: "var(--sans)" },
  { key: "mono", label: "Mono", css: "var(--mono)" },
] as const;

/** The text sizes: the token, the chip label, and the factor on the passage's stepped size. */
export const SIZES = [
  { key: "s", label: "S", scale: 0.85 },
  { key: "m", label: "M", scale: 1 },
  { key: "l", label: "L", scale: 1.18 },
] as const;

export type FontKey = (typeof FONTS)[number]["key"];
export type SizeKey = (typeof SIZES)[number]["key"];

/** The ink on the book's accent and on a fresh card. */
export const LIGHT_INK = "#f5f0e8";

/** The ink on a pale background. */
export const DARK_INK = "#221d18";

// sRGB channel to linear light.
const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a `#rrggbb` colour, or `null` when it is not one. */
export function relativeLuminance(hex: string): number | null {
  const digits = hex.replace(/^#/, "");
  if (digits.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) =>
    linear(Number.parseInt(digits.slice(i, i + 2), 16) || 0),
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG contrast ratio between two relative luminances. */
export const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// The passage's size as a fraction of the card width, stepped by its length.
const STEPS = [
  [90, 0.082],
  [180, 0.066],
  [320, 0.052],
  [520, 0.042],
] as const;
const LONGEST_STEP = 0.034;

/** The passage's font size as a fraction of the card width: its length-stepped size times the S/M/L factor. */
export function passageSize(chars: number, size: SizeKey): number {
  const step = STEPS.find(([below]) => chars < below)?.[1] ?? LONGEST_STEP;
  const scale = (SIZES.find((s) => s.key === size) ?? SIZES[1]).scale;
  return step * scale;
}

/** Folds runs of whitespace into single spaces and trims the ends. */
export const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

// Breaks one token wider than a line by code point, so CJK text and long URLs still wrap.
function breakToken(
  measure: (text: string) => number,
  token: string,
  maxWidth: number,
): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const char of token) {
    if (piece && measure(piece + char) > maxWidth) {
      pieces.push(piece);
      piece = char;
    } else {
      piece += char;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Greedy word wrap into at most `maxLines` lines no wider than `maxWidth`, measured by
 * `measure`. A token wider than a line breaks by character; a passage that runs past the
 * limit ends its last line in an ellipsis that still fits.
 */
export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
    if (measure(line) > maxWidth) {
      // Only reached by a lone token (a line of several words fit before this one joined it).
      const pieces = breakToken(measure, line, maxWidth);
      line = pieces.pop() ?? "";
      lines.push(...pieces);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = Array.from(kept[maxLines - 1] ?? "");
  while (last.length > 0 && measure(`${last.join("")}…`) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last.join("").trimEnd()}…`;
  return kept;
}

// The smallest a passage shrinks to, as a share of its stepped size, before it is clamped.
const MIN_PASSAGE_SCALE = 0.55;
const PASSAGE_SHRINK = 0.92;

/**
 * Wraps a passage at the largest size from `startPx` down to a floor at which it fits `maxLinesAt`
 * lines. Only at the floor does it clamp with an ellipsis. `measureAt` gives the measure for a size.
 */
export function fitPassage(
  measureAt: (px: number) => (text: string) => number,
  text: string,
  maxWidth: number,
  startPx: number,
  maxLinesAt: (px: number) => number,
): { px: number; lines: string[] } {
  const floor = startPx * MIN_PASSAGE_SCALE;
  let px = startPx;
  for (;;) {
    const measure = measureAt(px);
    const max = maxLinesAt(px);
    const all = wrapLines(measure, text, maxWidth, Number.POSITIVE_INFINITY);
    if (all.length <= max || px <= floor) {
      return { px, lines: wrapLines(measure, text, maxWidth, max) };
    }
    px = Math.max(floor, px * PASSAGE_SHRINK);
  }
}

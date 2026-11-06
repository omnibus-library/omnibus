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

/** The light or dark ink that reads on a hand-picked `#rrggbb` background, by relative luminance. */
export function inkFor(hex: string): string {
  const luminance = relativeLuminance(hex);
  return luminance !== null && luminance > 0.42 ? DARK_INK : LIGHT_INK;
}

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

/**
 * Greedy word wrap into at most `maxLines` lines no wider than `maxWidth`, measured by
 * `measure`. A passage that runs past the limit ends its last line in an ellipsis that
 * still fits; a word wider than a line takes a line of its own.
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
    if (measure(next) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? "";
  while (last && measure(`${last}…`) > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

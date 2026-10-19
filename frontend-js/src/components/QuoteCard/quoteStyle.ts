export const RATIOS = ["1:1", "4:5", "9:16", "3:4"] as const;

export type Ratio = (typeof RATIOS)[number];

/** The typefaces the editor offers: the token the canvas draws with, the chip label, and the preview's CSS stack. */
export const FONTS = [
  { key: "serif", label: "Serif", css: "var(--serif)" },
  { key: "sans", label: "Sans", css: "var(--sans)" },
  { key: "mono", label: "Mono", css: "var(--mono)" },
] as const;

/** The text sizes: the token the canvas scales by, the chip label, and the preview's CSS size. */
export const SIZES = [
  { key: "s", label: "S", css: "18px" },
  { key: "m", label: "M", css: "22px" },
  { key: "l", label: "L", css: "27px" },
] as const;

export type FontKey = (typeof FONTS)[number]["key"];
export type SizeKey = (typeof SIZES)[number]["key"];

/** The fixed background swatches, each with the ink that reads on it. */
export const PRESETS = [
  { bg: "#161412", ink: "#ece6dc" },
  { bg: "#f0ece2", ink: "#2a2520" },
  { bg: "rgb(34,197,94)", ink: "#0a2912" },
  { bg: "rgb(244,63,94)", ink: "#2a0810" },
] as const;

/** The ink on the book's accent and on a fresh card. */
export const LIGHT_INK = "#f5f0e8";

/** The preview's CSS font stack for a typeface token; an unknown token reads as serif. */
export const fontCss = (key: string) =>
  (FONTS.find((f) => f.key === key) ?? FONTS[0]).css;

/** The preview's CSS font size for a size token; an unknown token reads as medium. */
export const sizeCss = (key: string) =>
  (SIZES.find((s) => s.key === key) ?? SIZES[1]).css;

// sRGB channel to linear light.
const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** The light or dark ink that reads on a hand-picked `#rrggbb` background, by relative luminance. */
export function inkFor(hex: string): string {
  const digits = hex.replace(/^#/, "");
  if (digits.length !== 6) return LIGHT_INK;
  const [r, g, b] = [0, 2, 4].map((i) =>
    linear(Number.parseInt(digits.slice(i, i + 2), 16) || 0),
  );
  const luminance = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  return luminance > 0.42 ? "#221d18" : LIGHT_INK;
}

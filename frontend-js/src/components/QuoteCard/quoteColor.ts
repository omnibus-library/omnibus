import type { CoverPair } from "../../api";
import { contrast, DARK_INK, LIGHT_INK, relativeLuminance } from "./quoteStyle";

export type Oklch = { l: number; c: number; h: number };

/** What the canvas paints: two `#rrggbb` stops and the ink, at `angle` degrees (CSS's: 135 runs top-left to bottom-right; the default). */
export type Wash = { from: string; to: string; ink: string; angle?: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toDegrees = (rad: number) => (rad * 180) / Math.PI;

// Björn Ottosson's OKLab matrices, https://bottosson.github.io/posts/oklab/.
const encode = (linear: number) => {
  const c = clamp01(linear);
  return c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};
const decode = (channel: number) =>
  channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** An OKLCH colour as `#rrggbb`, its channels clipped into sRGB. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m_ = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s_ = (l - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  const rgb = [
    4.076_741_662_1 * l_ - 3.307_711_591_3 * m_ + 0.230_969_929_2 * s_,
    -1.268_438_004_6 * l_ + 2.609_757_401_1 * m_ - 0.341_319_396_5 * s_,
    -0.004_196_086_3 * l_ - 0.703_418_614_7 * m_ + 1.707_614_701 * s_,
  ];
  const digits = rgb.map((v) =>
    Math.round(encode(v) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${digits.join("")}`;
}

/** A `#rrggbb` colour as OKLCH; anything else reads as black. */
export function hexToOklch(hex: string): Oklch {
  const digits = hex.replace(/^#/, "");
  const [r, g, b] = [0, 2, 4].map((i) =>
    decode((Number.parseInt(digits.slice(i, i + 2), 16) || 0) / 255),
  ) as [number, number, number];
  const l = Math.cbrt(
    0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b,
  );
  const m = Math.cbrt(
    0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b,
  );
  const s = Math.cbrt(
    0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b,
  );
  const a = 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s;
  const bb = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s;
  return {
    l: 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    c: Math.hypot(a, bb),
    h: (toDegrees(Math.atan2(bb, a)) + 360) % 360,
  };
}

/** A solid background's flat base, its two-stop drift, and the ink that reads on it. */
export function solidWash(base: Oklch, lightInk: boolean): Wash {
  const toL = Math.max(0.06, base.l - (lightInk ? 0.1 : -0.05));
  return {
    from: oklchToHex(base),
    to: oklchToHex({ l: toL, c: base.c * 0.85, h: base.h + 12 }),
    ink: oklchToHex(
      lightInk
        ? { l: 0.95, c: 0.012, h: base.h }
        : { l: 0.24, c: 0.02, h: base.h },
    ),
  };
}

const HOUSE_TONE = "#3a3027";
const OKLCH_PATTERN = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

const clampBase = ({ l, c, h }: Oklch): Oklch => ({
  l: Math.min(0.46, Math.max(0.28, l)),
  c: Math.max(0.05, c),
  h,
});

/** The Book swatch's base: the book's `oklch(L C H)` accent held to a band the ink reads on. */
export function bookBase(accent: string | null): Oklch {
  const match = accent ? OKLCH_PATTERN.exec(accent) : null;
  const [l, c, h] = (match?.slice(1) ?? []).map(Number);
  const parsed =
    l !== undefined && c !== undefined && h !== undefined
      ? { l, c, h }
      : hexToOklch(HOUSE_TONE);
  return clampBase(parsed);
}

/** The Book swatch's wash. */
export const bookWash = (accent: string | null): Wash =>
  solidWash(bookBase(accent), true);

/** The wash for a hand-picked solid colour, its ink the one that reads best on it. */
export const customSolidWash = (hex: string): Wash =>
  solidWash(hexToOklch(hex), gradientInk(hex, hex) === LIGHT_INK);

/** The ink with the better worst-case contrast over both gradient stops. */
export function gradientInk(from: string, to: string): string {
  const stops = [from, to].map((hex) => relativeLuminance(hex) ?? 0);
  const worst = (ink: string) => {
    const lum = relativeLuminance(ink) ?? 0;
    return Math.min(...stops.map((stop) => contrast(lum, stop)));
  };
  return worst(LIGHT_INK) >= worst(DARK_INK) ? LIGHT_INK : DARK_INK;
}

/** A server cover pair as a wash. */
export const pairWash = (pair: CoverPair): Wash => ({
  from: pair.from,
  to: pair.to,
  ink: pair.ink === "light" ? LIGHT_INK : DARK_INK,
});

/** The six solid backgrounds after Book, each an OKLCH base and whether light ink sits on it. */
export const SOLIDS = [
  { id: "ink", name: "Ink", base: { l: 0.19, c: 0.012, h: 70 }, light: true },
  {
    id: "paper",
    name: "Paper",
    base: { l: 0.93, c: 0.017, h: 80 },
    light: false,
  },
  {
    id: "moss",
    name: "Moss",
    base: { l: 0.38, c: 0.075, h: 155 },
    light: true,
  },
  { id: "rose", name: "Rose", base: { l: 0.44, c: 0.11, h: 15 }, light: true },
  {
    id: "dusk",
    name: "Dusk",
    base: { l: 0.36, c: 0.085, h: 285 },
    light: true,
  },
  { id: "sea", name: "Sea", base: { l: 0.4, c: 0.075, h: 230 }, light: true },
] as const;

/** The gradient presets, the same on every book. */
export const GRADIENTS = [
  {
    id: "ember",
    name: "Ember",
    from: "#7a1f16",
    to: "#a24c16",
    ink: LIGHT_INK,
  },
  { id: "dusk", name: "Dusk", from: "#2e2660", to: "#9a4060", ink: LIGHT_INK },
  {
    id: "lagoon",
    name: "Lagoon",
    from: "#0b4a5a",
    to: "#26357f",
    ink: LIGHT_INK,
  },
  {
    id: "grove",
    name: "Grove",
    from: "#183f2a",
    to: "#7a5c18",
    ink: LIGHT_INK,
  },
  { id: "dawn", name: "Dawn", from: "#f7e1c8", to: "#eeb0a8", ink: DARK_INK },
] as const;

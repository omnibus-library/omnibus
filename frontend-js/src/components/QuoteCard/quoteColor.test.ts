import { describe, expect, it } from "vitest";
import {
  bookBase,
  GRADIENTS,
  gradientInk,
  hexToOklch,
  oklchToHex,
  solidWash,
} from "./quoteColor";
import { DARK_INK, LIGHT_INK } from "./quoteStyle";

describe("solidWash", () => {
  const base = { l: 0.4, c: 0.08, h: 150 };

  it("starts at the base and drifts darker and warmer for a light ink", () => {
    const wash = solidWash(base, true);
    const to = hexToOklch(wash.to);

    expect(wash.from).toBe(oklchToHex(base));
    expect(to.l).toBeCloseTo(0.3, 1);
    expect(to.c).toBeCloseTo(0.068, 1);
    expect(to.h).toBeCloseTo(162, -1);
    expect(hexToOklch(wash.ink).l).toBeCloseTo(0.95, 1);
  });

  it("drifts lighter for a dark ink", () => {
    const wash = solidWash({ l: 0.6, c: 0.1, h: 40 }, false);

    expect(hexToOklch(wash.to).l).toBeCloseTo(0.65, 1);
    expect(hexToOklch(wash.ink).l).toBeCloseTo(0.24, 1);
  });

  it("never drifts below the lightness floor", () => {
    const wash = solidWash({ l: 0.12, c: 0.02, h: 40 }, true);

    expect(hexToOklch(wash.to).l).toBeCloseTo(0.06, 1);
  });
});

describe("bookBase", () => {
  it("clamps a bright accent down to the card's ceiling", () => {
    expect(bookBase("oklch(0.9 0.2 30)")).toEqual({ l: 0.46, c: 0.2, h: 30 });
  });

  it("clamps a dark, grey accent up to the card's floor", () => {
    expect(bookBase("oklch(0.1 0.01 30)")).toEqual({ l: 0.28, c: 0.05, h: 30 });
  });

  it("leaves an accent already in the band alone", () => {
    expect(bookBase("oklch(0.4 0.1 250.5)")).toEqual({
      l: 0.4,
      c: 0.1,
      h: 250.5,
    });
  });

  it.each([
    ["null", null],
    ["garbage", "rebeccapurple"],
  ])("falls back to the house tone for %s", (_condition, accent) => {
    const base = bookBase(accent);

    expect(base).toEqual(bookBase(null));
    expect(base.h).toBeGreaterThan(50);
    expect(base.h).toBeLessThan(90);
    expect(base.l).toBeGreaterThanOrEqual(0.28);
    expect(base.l).toBeLessThanOrEqual(0.46);
    expect(base.c).toBe(0.05);
  });
});

describe("gradientInk", () => {
  it("picks the dark ink for the pale Dawn gradient", () => {
    const dawn = GRADIENTS.find((g) => g.id === "dawn");
    expect(dawn && gradientInk(dawn.from, dawn.to)).toBe(DARK_INK);
  });

  it("picks the light ink for the deep Ember gradient", () => {
    const ember = GRADIENTS.find((g) => g.id === "ember");
    expect(ember && gradientInk(ember.from, ember.to)).toBe(LIGHT_INK);
  });

  it("judges by the worse of the two stops", () => {
    expect(gradientInk("#000000", "#808080")).toBe(LIGHT_INK);
    expect(gradientInk("#ffffff", "#808080")).toBe(DARK_INK);
  });
});

describe("hexToOklch and oklchToHex", () => {
  it.each(["#ffffff", "#000000", "#7a1f16"])("round-trips %s", (hex) => {
    expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });

  it("reads white as full lightness and black as none", () => {
    expect(hexToOklch("#ffffff").l).toBeCloseTo(1, 2);
    expect(hexToOklch("#000000").l).toBeCloseTo(0, 2);
  });
});

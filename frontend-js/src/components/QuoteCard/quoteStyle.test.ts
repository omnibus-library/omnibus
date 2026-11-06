import { describe, expect, it } from "vitest";
import {
  collapse,
  fontCss,
  inkFor,
  passageSize,
  sizeCss,
  wrapLines,
} from "./quoteStyle";

describe("inkFor", () => {
  it.each([
    ["white", "#ffffff", "#221d18"],
    ["black", "#000000", "#f5f0e8"],
    ["a light grey", "#c0c0c0", "#221d18"],
    ["a mid grey", "#7f7f7f", "#f5f0e8"],
    ["a deep blue", "#1b2a6b", "#f5f0e8"],
    ["a bright yellow", "#ffe135", "#221d18"],
  ])("picks the ink for %s", (_condition, hex, ink) => {
    expect(inkFor(hex)).toBe(ink);
  });

  it.each([
    ["not a colour", "nope"],
    ["a short hex", "#fff"],
    ["empty", ""],
  ])("falls back to the light ink for %s", (_condition, hex) => {
    expect(inkFor(hex)).toBe("#f5f0e8");
  });
});

describe("fontCss", () => {
  it.each([
    ["serif", "var(--serif)"],
    ["sans", "var(--sans)"],
    ["mono", "var(--mono)"],
    ["cursive", "var(--serif)"],
  ])("maps %s to %s", (key, css) => {
    expect(fontCss(key)).toBe(css);
  });
});

describe("sizeCss", () => {
  it.each([
    ["s", "18px"],
    ["m", "22px"],
    ["l", "27px"],
    ["xl", "22px"],
  ])("maps %s to %s", (key, css) => {
    expect(sizeCss(key)).toBe(css);
  });
});

describe("passageSize", () => {
  it.each([
    [89, 0.082],
    [90, 0.066],
    [179, 0.066],
    [180, 0.052],
    [319, 0.052],
    [320, 0.042],
    [519, 0.042],
    [520, 0.034],
  ] as const)(
    "steps a %i-character passage to %f of the width",
    (chars, step) => {
      expect(passageSize(chars, "m")).toBeCloseTo(step, 6);
    },
  );

  it.each([
    ["s", 0.85],
    ["m", 1],
    ["l", 1.18],
  ] as const)("scales the step for size %s", (size, multiplier) => {
    expect(passageSize(100, size)).toBeCloseTo(0.066 * multiplier, 6);
  });
});

describe("collapse", () => {
  it("folds runs of whitespace into single spaces and trims the ends", () => {
    expect(collapse("  one\n\n two\t three  ")).toBe("one two three");
  });
});

describe("wrapLines", () => {
  // Every character is 10 wide.
  const measure = (text: string) => text.length * 10;

  it("breaks greedily at word boundaries", () => {
    expect(wrapLines(measure, "aaa bbb ccc ddd", 70, 5)).toEqual([
      "aaa bbb",
      "ccc ddd",
    ]);
  });

  it("keeps a text that fits on one line", () => {
    expect(wrapLines(measure, "short text", 200, 3)).toEqual(["short text"]);
  });

  it("ends the last kept line in an ellipsis that still fits", () => {
    const lines = wrapLines(measure, "aaa bbb ccc ddd eee", 70, 2);

    expect(lines).toEqual(["aaa bbb", "ccc dd…"]);
    expect(lines.every((line) => measure(line) <= 70)).toBe(true);
  });

  it("gives an overlong word a line of its own", () => {
    expect(wrapLines(measure, "ab supercalifragilistic cd", 100, 5)).toEqual([
      "ab",
      "supercalifragilistic",
      "cd",
    ]);
  });
});

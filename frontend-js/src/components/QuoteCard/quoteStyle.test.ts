import { describe, expect, it } from "vitest";
import { collapse, fitPassage, passageSize, wrapLines } from "./quoteStyle";

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

  it("breaks a token wider than a line by character so every line fits", () => {
    const lines = wrapLines(measure, "あ".repeat(120), 100, 20);

    expect(lines).toHaveLength(12);
    expect(lines.every((line) => measure(line) <= 100)).toBe(true);
    expect(lines.join("")).toBe("あ".repeat(120));
  });

  it("clamps an unbroken run with an ellipsis that fits", () => {
    const lines = wrapLines(measure, "あ".repeat(120), 100, 5);

    expect(lines).toHaveLength(5);
    expect(lines[4]?.endsWith("…")).toBe(true);
    expect(lines.every((line) => measure(line) <= 100)).toBe(true);
  });

  it("starts the next word after a broken one on the same line when it fits", () => {
    expect(wrapLines(measure, "supercalifragilistic cd", 100, 5)).toEqual([
      "supercalif",
      "ragilistic",
      "cd",
    ]);
  });

  it("trims an ellipsis line by whole code points", () => {
    const lines = wrapLines(
      measure,
      `${"😀".repeat(10)} ${"😀".repeat(10)}`,
      100,
      1,
    );

    expect(lines).toEqual([`${"😀".repeat(4)}…`]);
  });
});

describe("fitPassage", () => {
  // A character is `px * 0.6` wide; 3 lines fit at 90px and a few more as it shrinks.
  const measureAt = (px: number) => (text: string) => text.length * px * 0.6;
  const maxLinesAt = (px: number) => Math.floor(420 / (px * 1.54));
  const eightyFive =
    "Four score and seven years ago our fathers brought forth upon this continent a new";

  it("keeps the starting size when the passage already fits", () => {
    const fit = fitPassage(measureAt, "Short and sweet.", 800, 80, maxLinesAt);

    expect(fit.px).toBe(80);
    expect(fit.lines).toEqual(["Short and sweet."]);
  });

  it("steps the size down until a short passage fits without an ellipsis", () => {
    const fit = fitPassage(measureAt, eightyFive, 800, 88, maxLinesAt);

    expect(fit.px).toBeLessThan(88);
    expect(fit.px).toBeGreaterThanOrEqual(88 * 0.55);
    expect(fit.lines.join(" ")).toBe(eightyFive);
    expect(fit.lines.length).toBeLessThanOrEqual(maxLinesAt(fit.px));
  });

  it("only ellipsises once the size has hit its floor", () => {
    const long = "word ".repeat(400).trim();
    const fit = fitPassage(measureAt, long, 800, 88, maxLinesAt);

    expect(fit.px).toBeCloseTo(88 * 0.55, 6);
    expect(fit.lines).toHaveLength(maxLinesAt(fit.px));
    expect(fit.lines.at(-1)?.endsWith("…")).toBe(true);
  });
});

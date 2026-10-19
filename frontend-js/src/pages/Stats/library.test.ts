import { describe, expect, it } from "vitest";
import {
  audioValue,
  buildFigures,
  compact,
  coverage,
  heroSentence,
  spelled,
} from "./library";

const measured = (total: number, books: number) => ({ total, books });

describe("compact", () => {
  it("scales into K, M and B and leaves small counts alone", () => {
    expect(compact(0)).toBe("0");
    expect(compact(812)).toBe("812");
    // Under 10,000 stays exact: "9K" loses more than it saves.
    expect(compact(9_999)).toBe("9999");
    expect(compact(94_200)).toBe("94.2K");
    expect(compact(412_000_000)).toBe("412M");
    expect(compact(1_600_000)).toBe("1.6M");
    expect(compact(2_400_000_000)).toBe("2.4B");
  });

  // The tier below would round these to "1000K" and "1000M", which reads as a bug rather than a number.
  it("promotes a value that rounds up into the next unit", () => {
    expect(compact(999_999)).toBe("1.0M");
    expect(compact(999_999_999)).toBe("1.0B");
    expect(compact(999_499)).toBe("999K");
    expect(compact(999_499_999)).toBe("999M");
  });

  // 1.25 is exact in binary, so Rust's `{:.1}` settles it on the even 1.2 where toFixed says 1.3.
  it("settles a half-way figure on the even decimal, as Rust formats it", () => {
    expect(compact(1_250_000)).toBe("1.2M");
  });
});

describe("audioValue", () => {
  it("switches from hours to days past a week", () => {
    expect(audioValue(3600)).toEqual({ value: "1", unit: "hour" });
    expect(audioValue(12 * 3600)).toEqual({ value: "12", unit: "hours" });
    expect(audioValue(94 * 24 * 3600)).toEqual({ value: "94", unit: "days" });
  });

  // 1h40m rounds to 2, so the unit has to follow the figure the reader sees.
  it("pluralizes off the rounded hours, not the raw ones", () => {
    expect(audioValue(6000)).toEqual({ value: "2", unit: "hours" });
    expect(audioValue(3500)).toEqual({ value: "1", unit: "hour" });
  });

  // The days promotion follows the rounded hours too, so nothing reads "168 hours" on its way past a week.
  it("promotes to days off the rounded hours", () => {
    expect(audioValue(167 * 3600 + 2400)).toEqual({ value: "7", unit: "days" });
  });
});

describe("coverage", () => {
  it("always states the denominator", () => {
    expect(coverage(measured(1, 1_204), 1_510)).toBe(
      "across 1,204 of 1,510 books",
    );
  });

  it("pluralizes the denominator's noun", () => {
    expect(coverage(measured(1, 1), 1)).toBe("across 1 of 1 book");
  });
});

describe("buildFigures", () => {
  // A "0 words" tile would describe a library that doesn't exist.
  it("skips anything the library has not measured", () => {
    const figures = buildFigures({
      books: 1_510,
      words: measured(412_000_000, 1_204),
      pages: measured(1_600_000, 1_204),
      listening_seconds: measured(0, 0),
    });

    expect(figures).toEqual([
      {
        value: "412M",
        unit: "words",
        coverage: "across 1,204 of 1,510 books",
      },
      {
        value: "1.6M",
        unit: "est. pages",
        coverage: "across 1,204 of 1,510 books",
      },
    ]);
  });

  it("is empty for a library measured for nothing", () => {
    expect(
      buildFigures({
        books: 40,
        words: measured(0, 0),
        pages: measured(0, 0),
        listening_seconds: measured(0, 0),
      }),
    ).toEqual([]);
  });

  it("converts the audio total into the unit that fits", () => {
    const [audio] = buildFigures({
      books: 1_510,
      words: measured(0, 0),
      pages: measured(0, 0),
      listening_seconds: measured(94 * 24 * 3600, 88),
    });

    expect(audio).toEqual({
      value: "94",
      unit: "days",
      coverage: "across 88 of 1,510 books",
    });
  });
});

describe("spelled", () => {
  it("writes a count the way a reader would say it", () => {
    expect(spelled(412_000_000)).toBe("412 million");
    expect(spelled(1_600_000)).toBe("1.6 million");
    expect(spelled(2_400_000_000)).toBe("2.4 billion");
    expect(spelled(94_200)).toBe("94.2 thousand");
  });

  it("groups a count too small for a word", () => {
    expect(spelled(812)).toBe("812");
    expect(spelled(1_234)).toBe("1,234");
  });

  it("promotes a value that rounds up into the next word", () => {
    expect(spelled(999_999)).toBe("1.0 million");
  });
});

describe("heroSentence", () => {
  it("tints the words clause of the sentence", () => {
    expect(
      heroSentence({
        books: 1_510,
        words: measured(412_000_000, 1_204),
      }),
    ).toEqual({
      books: "1,510 books.",
      words: "412 million words",
      tail: " waiting on the shelf.",
    });
  });

  it("says only how many books when no words are measured", () => {
    expect(heroSentence({ books: 1, words: measured(0, 0) })).toEqual({
      books: "1 book.",
      words: null,
      tail: "",
    });
  });
});

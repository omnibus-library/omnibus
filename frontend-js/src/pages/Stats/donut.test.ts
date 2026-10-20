import { describe, expect, it } from "vitest";
import { donutGradient, foldShares, percentages, untaggedNote } from "./donut";

const share = (name: string, books: number) => ({ name, books });

describe("foldShares", () => {
  it("keeps the top four and folds the tail into Other", () => {
    const shares = [1, 2, 3, 4, 5, 6].map((i) => share(`g${i}`, 7 - i));
    const folded = foldShares(shares);

    expect(folded).toHaveLength(5);
    expect(folded[0]).toEqual(share("g1", 6));
    expect(folded[4]).toEqual(share("Other", 3));
  });

  it("leaves an empty list empty and a short one unfolded", () => {
    expect(foldShares([])).toEqual([]);
    expect(foldShares([share("solo", 2)])).toHaveLength(1);
  });

  // The server no longer truncates to a top eight, so Other is the real remainder.
  it("folds the whole tail the server sent", () => {
    const shares = Array.from({ length: 12 }, (_, i) => share(`g${i + 1}`, 1));
    const folded = foldShares(shares);

    expect(folded).toHaveLength(5);
    expect(folded[4]).toEqual(share("Other", 8));
    expect(
      percentages(folded.map((s) => s.books)).reduce((a, b) => a + b, 0),
    ).toBe(100);
  });
});

describe("percentages", () => {
  it.each([[[1, 1, 1]], [[2, 1]], [[7, 2, 1]], [[1, 1, 1, 1, 1, 1, 1]]])(
    "sums %j to exactly one hundred",
    (counts) => {
      expect(percentages(counts).reduce((a, b) => a + b, 0)).toBe(100);
    },
  );

  it("hands the leftover points to the largest remainders, earlier slots first on a tie", () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([3, 1])).toEqual([75, 25]);
  });

  it("is all zeros without a total to divide by", () => {
    expect(percentages([])).toEqual([]);
    expect(percentages([0, 0])).toEqual([0, 0]);
  });
});

describe("untaggedNote", () => {
  it("singularizes one book", () => {
    expect(untaggedNote(1)).toBe("+1 book without a genre");
    expect(untaggedNote(4)).toBe("+4 books without a genre");
  });
});

describe("donutGradient", () => {
  it("builds cumulative stops", () => {
    expect(donutGradient([36, 28, 20, 16])).toBe(
      "conic-gradient(var(--st-donut-c0) 0% 36%, var(--st-donut-c1) 36% 64%, var(--st-donut-c2) 64% 84%, var(--st-donut-c3) 84% 100%)",
    );
  });

  // Per-slice widths would leave an empty genre's colour showing for a fraction of a degree.
  it("collapses an empty genre instead of leaving a hairline", () => {
    const gradient = donutGradient([60, 0, 40]);

    expect(gradient).toContain("var(--st-donut-c1) 60% 60%");
    expect(gradient).toContain("var(--st-donut-c2) 60% 100%");
  });

  it("colours the fold with the Other token", () => {
    expect(donutGradient([20, 20, 20, 20, 20])).toContain(
      "var(--st-donut-other) 80% 100%",
    );
  });
});

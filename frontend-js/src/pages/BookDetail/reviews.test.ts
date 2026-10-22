import { describe, expect, it } from "vitest";
import { type MyReview, toBookReviews } from "../../api";
import {
  aWireBookReviews,
  aWireOtherReview,
  aWireReview,
  aWireReviewSummary,
} from "../../testing/wire";
import {
  applyLocally,
  composerSeed,
  isNoChange,
  movesStars,
  needsReadMore,
  optimisticReviews,
  saveChange,
  spoilerVeiled,
  textChange,
} from "./reviews";

const NOW = 2_000_000_000;

const reviewsOf = (wire: Parameters<typeof aWireBookReviews>[0]) =>
  toBookReviews(aWireBookReviews(wire));

const mine = (overrides: Parameters<typeof aWireReview>[0] = {}) =>
  reviewsOf({ mine: aWireReview(overrides) }).mine as MyReview;

describe("applyLocally", () => {
  it("starts a review from nothing on the first tap", () => {
    expect(applyLocally(null, 4, NOW)).toMatchObject({
      stars: 4,
      ratedAt: NOW,
      bodyMd: null,
      spoiler: false,
    });
  });

  it("clears only the stars, keeping the text", () => {
    const written = mine({ body_md: "Good.", body_html: "<p>Good.</p>" });
    expect(applyLocally(written, null, NOW)).toMatchObject({
      stars: null,
      ratedAt: null,
      bodyMd: "Good.",
      bodyHtml: "<p>Good.</p>",
    });
  });

  it("empties a review left with nothing", () => {
    expect(applyLocally(mine({ stars: 2 }), null, NOW)).toBeNull();
  });
});

describe("optimisticReviews", () => {
  const reviews = reviewsOf({
    mine: aWireReview({ stars: 2 }),
    others: [aWireOtherReview()],
    summary: aWireReviewSummary(2, 3.5),
  });

  it("changes only your review, leaving the others and the summary to the re-read", () => {
    const next = optimisticReviews(reviews, { stars: 5 }, NOW);
    expect(next.mine?.stars).toBe(5);
    expect(next.others).toBe(reviews.others);
    expect(next.summary).toBe(reviews.summary);
  });

  it("keeps everything while a delete waits for the server", () => {
    expect(optimisticReviews(reviews, "delete", NOW)).toBe(reviews);
  });

  it("leaves the composer's Save to the server, the spoiler flag included", () => {
    expect(
      optimisticReviews(reviews, { bodyMd: "New.", spoiler: true }, NOW),
    ).toBe(reviews);
  });
});

describe("saveChange", () => {
  const seed = composerSeed(
    mine({ body_md: "Rosebud.", body_html: "<p>x</p>", spoiler: true }),
  );

  it("seeds from the saved review, and from nothing for a new one", () => {
    expect(seed).toEqual({ bodyMd: "Rosebud.", notesMd: "", spoiler: true });
    expect(composerSeed(null)).toEqual({
      bodyMd: "",
      notesMd: "",
      spoiler: false,
    });
  });

  it("counts a flag-only change as one worth saving", () => {
    expect(saveChange(seed, { ...seed, spoiler: false })).toEqual({
      spoiler: false,
    });
  });

  it("sends the flag with the text only when it moved", () => {
    expect(saveChange(seed, { ...seed, bodyMd: "Rosebud, again." })).toEqual({
      bodyMd: "Rosebud, again.",
    });
    expect(
      saveChange(composerSeed(null), {
        bodyMd: "Spoiled.",
        notesMd: "",
        spoiler: true,
      }),
    ).toEqual({ bodyMd: "Spoiled.", spoiler: true });
  });

  it("is no change when nothing moved", () => {
    expect(isNoChange(saveChange(seed, seed))).toBe(true);
  });
});

describe("movesStars", () => {
  it("counts a stars change, cleared or set, and a delete", () => {
    expect(movesStars({ stars: 4 })).toBe(true);
    expect(movesStars({ stars: null })).toBe(true);
    expect(movesStars("delete")).toBe(true);
  });

  it("leaves out text, notes and the spoiler flag", () => {
    expect(movesStars({ bodyMd: "x", notesMd: null, spoiler: true })).toBe(
      false,
    );
  });
});

describe("textChange", () => {
  it("sends only the fields that changed", () => {
    expect(
      textChange(
        { bodyMd: "Loved it", notesMd: "" },
        { bodyMd: "Loved it", notesMd: "Check chapter 3" },
      ),
    ).toEqual({ notesMd: "Check chapter 3" });
  });

  it("clears a field emptied to whitespace", () => {
    expect(
      textChange({ bodyMd: "x", notesMd: "" }, { bodyMd: "  ", notesMd: "" }),
    ).toEqual({ bodyMd: null });
  });

  it("is no change when nothing changed", () => {
    expect(
      isNoChange(
        textChange(
          { bodyMd: "a", notesMd: "b" },
          { bodyMd: "a", notesMd: "b" },
        ),
      ),
    ).toBe(true);
    expect(
      isNoChange(
        textChange({ bodyMd: "", notesMd: "" }, { bodyMd: " ", notesMd: "" }),
      ),
    ).toBe(true);
  });

  it("never touches the stars or the spoiler flag", () => {
    const change = textChange(
      { bodyMd: "", notesMd: "" },
      { bodyMd: "New.", notesMd: "" },
    );
    expect(change).toEqual({ bodyMd: "New." });
  });
});

describe("spoilerVeiled", () => {
  it("holds until revealed or the book is finished", () => {
    expect(spoilerVeiled(true, false, false)).toBe(true);
    expect(spoilerVeiled(true, false, true)).toBe(false);
    expect(spoilerVeiled(true, true, false)).toBe(false);
    expect(spoilerVeiled(false, false, false)).toBe(false);
  });
});

describe("needsReadMore", () => {
  it("clips long or many-lined text", () => {
    expect(needsReadMore("short")).toBe(false);
    expect(needsReadMore("x".repeat(421))).toBe(true);
    expect(needsReadMore("x".repeat(420))).toBe(false);
    expect(needsReadMore("1\n2\n3\n4\n5\n6\n7")).toBe(true);
    expect(needsReadMore("1\n2\n3\n4\n5\n6")).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(needsReadMore(`\n\n${"x".repeat(420)}\n\n\n\n\n\n`)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { type MyReview, type OtherReview, toBookReviews } from "../../api";
import {
  aWireBookReviews,
  aWireOtherReview,
  aWireReview,
  aWireReviewSummary,
} from "../../testing/wire";
import {
  applyLocally,
  averageLabel,
  composerSeed,
  isNoChange,
  jumpLabel,
  movesStars,
  needsReadMore,
  optimisticReviews,
  reviewsKicker,
  saveChange,
  splitOthers,
  spoilerVeiled,
  spreadBars,
  spreadSummary,
  textChange,
} from "./reviews";

const NOW = 2_000_000_000;

const reviewsOf = (wire: Parameters<typeof aWireBookReviews>[0]) =>
  toBookReviews(aWireBookReviews(wire));

const mine = (overrides: Parameters<typeof aWireReview>[0] = {}) =>
  reviewsOf({ mine: aWireReview(overrides) }).mine as MyReview;

const others = (...wire: Parameters<typeof aWireOtherReview>[0][]) =>
  reviewsOf({ others: wire.map((w) => aWireOtherReview(w)) }).others;

/** Ten buckets from a reader count per half star, lowest first. */
const buckets = (readers: number[]) =>
  readers.map((n, i) => ({ halfStars: i + 1, readers: n }));

describe("applyLocally", () => {
  it("starts a review from nothing on the first tap", () => {
    expect(applyLocally(null, { stars: 4 }, NOW)).toMatchObject({
      stars: 4,
      ratedAt: NOW,
      bodyMd: null,
      spoiler: false,
    });
  });

  it("clears only the stars, keeping the text", () => {
    const written = mine({ body_md: "Good.", body_html: "<p>Good.</p>" });
    expect(applyLocally(written, { stars: null }, NOW)).toMatchObject({
      stars: null,
      ratedAt: null,
      bodyMd: "Good.",
      bodyHtml: "<p>Good.</p>",
    });
  });

  it("flags the spoiler", () => {
    const written = mine({ body_md: "Rosebud.", body_html: "<p>x</p>" });
    expect(applyLocally(written, { spoiler: true }, NOW)?.spoiler).toBe(true);
  });

  it("leaves text to the server, which renders it", () => {
    const written = mine({ body_md: "Good.", body_html: "<p>Good.</p>" });
    expect(applyLocally(written, { bodyMd: "Great." }, NOW)).toMatchObject({
      bodyMd: "Good.",
      bodyHtml: "<p>Good.</p>",
    });
  });

  it("empties a review left with nothing", () => {
    expect(applyLocally(mine({ stars: 2 }), { stars: null }, NOW)).toBeNull();
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

describe("splitOthers", () => {
  it("keeps the server's order within each group", () => {
    const list = others(
      { user_id: 1, body_md: "a", body_html: "<p>a</p>", stars: null },
      { user_id: 2, body_md: "b", body_html: "<p>b</p>" },
      { user_id: 3 },
      { user_id: 4, stars: 5 },
    );
    const { texts, ratings } = splitOthers(list);
    expect(texts.map((r: OtherReview) => r.reader.id)).toEqual([1, 2]);
    expect(ratings.map((r: OtherReview) => r.reader.id)).toEqual([3, 4]);
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

describe("reviewsKicker", () => {
  it("counts texts and ratings, yours included", () => {
    const reviews = reviewsOf({
      mine: aWireReview({ stars: 4, body_md: "Mine.", body_html: "<p>m</p>" }),
      others: [
        aWireOtherReview({ user_id: 2, body_md: "b", body_html: "<p>b</p>" }),
        aWireOtherReview({ user_id: 3, stars: 2 }),
      ],
    });
    expect(reviewsKicker(reviews)).toBe("2 reviews · 3 ratings");
  });

  it("ignores notes and says when there is nothing", () => {
    expect(reviewsKicker(reviewsOf({}))).toBe("No reviews yet");
    const notesOnly = reviewsOf({
      mine: aWireReview({ stars: null, notes_md: "n", notes_html: "<p>n</p>" }),
    });
    expect(reviewsKicker(notesOnly)).toBe("No reviews yet");
  });

  it("counts a lone rating in the singular", () => {
    expect(reviewsKicker(reviewsOf({ mine: aWireReview({ stars: 3 }) }))).toBe(
      "0 reviews · 1 rating",
    );
  });
});

describe("averageLabel", () => {
  it("rounds to one decimal, a half up", () => {
    expect(averageLabel(4.333)).toBe("4.3");
    expect(averageLabel(4.0)).toBe("4.0");
    expect(averageLabel(3.96)).toBe("4.0");
    expect(averageLabel(4.25)).toBe("4.3");
  });

  it("labels the jump link for a screen reader", () => {
    const { summary } = reviewsOf({ summary: aWireReviewSummary(4, 4.5, 4.5) });
    expect(summary && jumpLabel(summary)).toBe(
      "Rated 4.3 by 3 readers — go to the reviews",
    );
  });
});

describe("spreadBars", () => {
  const bars = spreadBars(buckets([0, 1, 0, 0, 0, 1, 0, 2, 0, 1]));

  it("scales each bar to the fullest bucket and labels whole stars only", () => {
    expect(bars).toHaveLength(10);
    expect(bars[7]?.heightPct).toBe(100);
    expect(bars[5]?.heightPct).toBe(50);
    expect(bars[0]?.heightPct).toBe(0);
    expect(bars[0]?.label).toBe("");
    expect(bars[1]?.label).toBe("1");
    expect(bars[9]?.label).toBe("5");
    expect(bars[8]?.title).toBe("4.5 ★ · 0 readers");
  });

  it("rounds a half percent up", () => {
    const thirds = spreadBars(buckets([1, 0, 0, 0, 0, 0, 0, 0, 0, 3]));
    expect(thirds[0]?.heightPct).toBe(33);
    const halves = spreadBars(buckets([1, 0, 0, 0, 0, 0, 0, 0, 0, 8]));
    expect(halves[0]?.heightPct).toBe(13);
  });
});

describe("spreadSummary", () => {
  it("names each value given, lowest first", () => {
    expect(spreadSummary(buckets([0, 0, 0, 0, 0, 0, 1, 0, 2, 0]))).toBe(
      "Ratings by stars: 1 reader at 3.5, 2 readers at 4.5.",
    );
    expect(spreadSummary(buckets(Array(10).fill(0)))).toBe(
      "Ratings by stars: none.",
    );
  });
});

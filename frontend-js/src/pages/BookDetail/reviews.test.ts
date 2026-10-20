import { describe, expect, it } from "vitest";
import { type MyReview, type OtherReview, toBookReviews } from "../../api";
import {
  aWireBookReviews,
  aWireOtherReview,
  aWireReview,
  aWireReviewSummary,
} from "../../testing/wire";
import {
  draftChange,
  householdLabel,
  householdLine,
  isNoChange,
  movesStars,
  optimisticReviews,
  reviewsKicker,
  splitOthers,
  spreadBars,
  spreadLabel,
  startsCovered,
  withChange,
} from "./reviews";

const NOW = 2_000_000_000;

const reviewsOf = (wire: Parameters<typeof aWireBookReviews>[0]) =>
  toBookReviews(aWireBookReviews(wire));

const mine = (overrides: Parameters<typeof aWireReview>[0] = {}) =>
  reviewsOf({ mine: aWireReview(overrides) }).mine as MyReview;

const others = (...wire: Parameters<typeof aWireOtherReview>[0][]) =>
  reviewsOf({ others: wire.map((w) => aWireOtherReview(w)) }).others;

describe("withChange", () => {
  it("starts a review from nothing on the first tap", () => {
    expect(withChange(null, { stars: 3.5 }, NOW)).toMatchObject({
      stars: 3.5,
      ratedAt: NOW,
      bodyMd: null,
      spoiler: false,
    });
  });

  it("clears only the stars, keeping the text", () => {
    const written = mine({ body_md: "Good.", body_html: "<p>Good.</p>" });
    expect(withChange(written, { stars: null }, NOW)).toMatchObject({
      stars: null,
      ratedAt: null,
      bodyMd: "Good.",
      bodyHtml: "<p>Good.</p>",
    });
  });

  it("drops the rendering of changed text, so it shows as written until the server renders it", () => {
    const written = mine({ body_md: "Good.", body_html: "<p>Good.</p>" });
    expect(withChange(written, { bodyMd: "Great." }, NOW)).toMatchObject({
      bodyMd: "Great.",
      bodyHtml: null,
    });
  });

  it("keeps the rendering of text sent back unchanged", () => {
    const written = mine({ notes_md: "n", notes_html: "<p>n</p>" });
    expect(withChange(written, { notesMd: "n" }, NOW)?.notesHtml).toBe(
      "<p>n</p>",
    );
  });

  it("reads blank text as cleared", () => {
    const written = mine({ stars: 2, body_md: "x", body_html: "<p>x</p>" });
    expect(withChange(written, { bodyMd: "   " }, NOW)?.bodyMd).toBeNull();
  });

  it("leaves nothing once stars, text and notes are all gone", () => {
    expect(withChange(mine({ stars: 2 }), { stars: null }, NOW)).toBeNull();
  });
});

describe("optimisticReviews", () => {
  const reviews = reviewsOf({
    mine: aWireReview({ stars: 2 }),
    others: [aWireOtherReview()],
    summary: aWireReviewSummary(2, 3.5),
  });

  it("changes only your review, leaving the others and the summary to the refetch", () => {
    const next = optimisticReviews(reviews, { stars: 5 }, NOW);
    expect(next.mine?.stars).toBe(5);
    expect(next.others).toBe(reviews.others);
    expect(next.summary).toBe(reviews.summary);
  });

  it("keeps everything while a delete waits for the server", () => {
    expect(optimisticReviews(reviews, "delete", NOW)).toBe(reviews);
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

describe("draftChange", () => {
  const draft = { bodyMd: "", notesMd: "", spoiler: false };

  it("is no change when nothing was written and there is no review", () => {
    expect(isNoChange(draftChange(null, draft))).toBe(true);
  });

  it("sends only the field that changed", () => {
    const saved = mine({ body_md: "Good.", notes_md: "for me" });
    expect(
      draftChange(saved, { ...draft, bodyMd: "Good.", notesMd: "for later" }),
    ).toEqual({ notesMd: "for later" });
  });

  it("sends blank text as cleared, and only when there was text", () => {
    const saved = mine({ body_md: "Good." });
    expect(draftChange(saved, { ...draft, bodyMd: "  " })).toEqual({
      bodyMd: null,
    });
    expect(isNoChange(draftChange(mine(), { ...draft, notesMd: "\n" }))).toBe(
      true,
    );
  });

  it("sends the spoiler flag with new text", () => {
    expect(
      draftChange(null, { ...draft, bodyMd: "Rosebud.", spoiler: true }),
    ).toEqual({ bodyMd: "Rosebud.", spoiler: true });
  });

  it("drops the spoiler flag along with the text it marked", () => {
    const saved = mine({ body_md: "Rosebud.", spoiler: true });
    expect(draftChange(saved, { ...draft, spoiler: true })).toEqual({
      bodyMd: null,
      spoiler: false,
    });
  });

  it("ignores a spoiler tick with no text to mark", () => {
    expect(isNoChange(draftChange(null, { ...draft, spoiler: true }))).toBe(
      true,
    );
  });
});

describe("splitOthers", () => {
  it("keeps the server's order and puts text reviews apart from bare ratings", () => {
    const list = others(
      { user_id: 2, body_md: "b", body_html: "<p>b</p>", stars: null },
      { user_id: 3, body_md: "c", body_html: "<p>c</p>" },
      { user_id: 4 },
      { user_id: 5, stars: 5 },
    );
    const { written, ratedOnly } = splitOthers(list);
    expect(written.map((r: OtherReview) => r.reader.id)).toEqual([2, 3]);
    expect(ratedOnly.map((r: OtherReview) => r.reader.id)).toEqual([4, 5]);
  });

  it("is empty for a book nobody else reviewed", () => {
    expect(splitOthers([])).toEqual({ written: [], ratedOnly: [] });
  });
});

describe("startsCovered", () => {
  it.each([
    [true, "reading", true],
    [true, "unread", true],
    [true, null, true],
    [true, undefined, true],
    [true, "finished", false],
    [false, "reading", false],
  ] as const)(
    "spoiler %s, viewer %s: covered %s",
    (spoiler, status, covered) => {
      expect(startsCovered({ spoiler }, status)).toBe(covered);
    },
  );
});

describe("householdLine", () => {
  it("rounds the average to one place and counts the readers", () => {
    const summary = reviewsOf({
      summary: aWireReviewSummary(4, 4.5, 4.5),
    }).summary;
    expect(summary && householdLine(summary)).toBe("★ 4.3 · 3 readers");
    expect(summary && householdLabel(summary)).toBe(
      "Rated 4.3 out of 5 on average by 3 readers",
    );
  });

  it("keeps the decimal on a whole average", () => {
    const summary = reviewsOf({ summary: aWireReviewSummary(4, 4) }).summary;
    expect(summary && householdLine(summary)).toBe("★ 4.0 · 2 readers");
  });
});

describe("spreadBars", () => {
  const { summary } = reviewsOf({ summary: aWireReviewSummary(3.5, 5, 5) });
  const bars = summary ? spreadBars(summary.buckets) : [];

  it("draws one column per half star, labelled in stars", () => {
    expect(bars.map((b) => b.label)).toEqual([
      "0.5",
      "1",
      "1.5",
      "2",
      "2.5",
      "3",
      "3.5",
      "4",
      "4.5",
      "5",
    ]);
  });

  it("scales each column to the fullest bucket", () => {
    expect(bars[6]).toMatchObject({ readers: 1, heightPct: 50 });
    expect(bars[9]).toMatchObject({
      readers: 2,
      heightPct: 100,
      title: "5 ★ · 2 readers",
    });
    expect(bars[0]).toMatchObject({ readers: 0, heightPct: 0 });
  });

  it("says who gave what, for the chart's label", () => {
    expect(summary && spreadLabel(summary.buckets)).toBe(
      "1 reader gave 3.5 stars, 2 gave 5 stars",
    );
    expect(spreadLabel([])).toBe("No star ratings yet");
  });
});

describe("reviewsKicker", () => {
  it("says so when nobody has rated or reviewed the book", () => {
    expect(reviewsKicker(reviewsOf({}))).toBe("No reviews yet");
  });

  it("counts every reader with stars or text, yourself included, and those who wrote", () => {
    const reviews = reviewsOf({
      mine: aWireReview({ body_md: "Mine.", body_html: "<p>Mine.</p>" }),
      others: [
        aWireOtherReview({ user_id: 2, body_md: "b", body_html: "<p>b</p>" }),
        aWireOtherReview({ user_id: 3 }),
      ],
    });
    expect(reviewsKicker(reviews)).toBe("3 readers · 2 with a review");
  });

  it("leaves out your private notes, which no one else sees", () => {
    const reviews = reviewsOf({
      mine: aWireReview({ stars: null, notes_md: "n", notes_html: "<p>n</p>" }),
    });
    expect(reviewsKicker(reviews)).toBe("No reviews yet");
  });
});

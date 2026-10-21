import { describe, expect, it } from "vitest";
import { halfStarLabel, ratingAfterClick, starsMeta } from "./rating";

describe("halfStarLabel", () => {
  it.each([
    ["a star not yet given", 4, 3, "Rate 4 stars"],
    ["the first star", 1, null, "Rate 1 star"],
    ["a half star", 3.5, null, "Rate 3.5 stars"],
    ["the current whole rating", 3, 3, "Clear your 3-star rating"],
    ["the current half rating", 0.5, 0.5, "Clear your 0.5-star rating"],
  ])("labels %s", (_condition, value, current, label) => {
    expect(halfStarLabel(value, current)).toBe(label);
  });
});

describe("ratingAfterClick", () => {
  it("saves the value clicked", () => {
    expect(ratingAfterClick(4.5, 3)).toBe(4.5);
    expect(ratingAfterClick(4.5, null)).toBe(4.5);
  });

  it("clears the rating when its own value is clicked again", () => {
    expect(ratingAfterClick(4.5, 4.5)).toBeNull();
  });
});

describe("starsMeta", () => {
  const review = { stars: 4, ratedAt: 1_000, updatedAt: 1_500 };

  it("says Not rated yet without a review, or with a review that has no stars", () => {
    expect(starsMeta(2_000, false, null)).toBe("Not rated yet");
    expect(starsMeta(2_000, false, undefined)).toBe("Not rated yet");
    expect(
      starsMeta(2_000, false, { stars: null, ratedAt: null, updatedAt: 1 }),
    ).toBe("Not rated yet");
  });

  it("gives the age and value of the stars", () => {
    expect(starsMeta(1_000 + 3 * 3600, false, review)).toBe(
      "rated 3 hours ago · 4 of 5",
    );
    expect(starsMeta(1_010, false, { ...review, stars: 4.5 })).toBe(
      "rated just now · 4.5 of 5",
    );
  });

  it("dates the stars by the last change when they carry no time of their own", () => {
    expect(
      starsMeta(1_500 + 120, false, {
        stars: 2,
        ratedAt: null,
        updatedAt: 1_500,
      }),
    ).toBe("rated 2 minutes ago · 2 of 5");
  });

  it("puts a refused save before everything else", () => {
    expect(starsMeta(2_000, true, review)).toBe(
      "Couldn’t save your rating — try again",
    );
  });
});

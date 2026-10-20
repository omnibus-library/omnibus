import { describe, expect, it } from "vitest";
import { halfStarLabel, ratingAfterClick, ratingMeta } from "./rating";

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

describe("ratingMeta", () => {
  const review = { stars: 4, ratedAt: 1_000 };

  it("says Not rated yet without a review, or with a review that has no stars", () => {
    expect(ratingMeta(false, null, 2_000)).toBe("Not rated yet");
    expect(ratingMeta(false, undefined, 2_000)).toBe("Not rated yet");
    expect(ratingMeta(false, { stars: null, ratedAt: null }, 2_000)).toBe(
      "Not rated yet",
    );
  });

  it("gives the age and value of the stars", () => {
    expect(ratingMeta(false, review, 1_000 + 3 * 3600)).toBe(
      "rated 3 hours ago · 4 of 5",
    );
    expect(ratingMeta(false, { ...review, stars: 4.5 }, 1_010)).toBe(
      "rated just now · 4.5 of 5",
    );
  });

  it("gives the value alone when the stars carry no time", () => {
    expect(ratingMeta(false, { stars: 2, ratedAt: null }, 1_000)).toBe(
      "2 of 5",
    );
  });

  it("puts a failure before everything else", () => {
    expect(ratingMeta(true, review, 2_000)).toBe("Couldn't save — try again");
  });
});

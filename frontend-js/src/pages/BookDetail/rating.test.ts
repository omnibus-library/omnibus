import { describe, expect, it } from "vitest";
import { halfStarLabel, ratingAfterClick, ratingMeta } from "./rating";

describe("halfStarLabel", () => {
  it.each([
    ["a star not yet given", 4, 3, "Rate 4 stars"],
    ["the first star", 1, undefined, "Rate 1 star"],
    ["a half star", 3.5, undefined, "Rate 3.5 stars"],
    ["the current whole rating", 3, 3, "Clear your 3-star rating"],
    ["the current half rating", 0.5, 0.5, "Clear your 0.5-star rating"],
  ])("labels %s", (_condition, value, current, label) => {
    expect(halfStarLabel(value, current)).toBe(label);
  });
});

describe("ratingAfterClick", () => {
  it("saves the value clicked", () => {
    expect(ratingAfterClick(4.5, 3)).toBe(4.5);
    expect(ratingAfterClick(4.5, undefined)).toBe(4.5);
  });

  it("clears the rating when its own value is clicked again", () => {
    expect(ratingAfterClick(4.5, 4.5)).toBeNull();
  });
});

describe("ratingMeta", () => {
  const record = { stars: 4, updatedAt: 1_000 };

  it("says Not rated yet without a record", () => {
    expect(ratingMeta(false, null, 2_000)).toBe("Not rated yet");
    expect(ratingMeta(false, undefined, 2_000)).toBe("Not rated yet");
  });

  it("gives the age and value of a saved rating", () => {
    expect(ratingMeta(false, record, 1_000 + 3 * 3600)).toBe(
      "rated 3 hours ago · 4 of 5",
    );
    expect(ratingMeta(false, { ...record, stars: 4.5 }, 1_010)).toBe(
      "rated just now · 4.5 of 5",
    );
  });

  it("puts a failure before everything else", () => {
    expect(ratingMeta(true, record, 2_000)).toBe(
      "Couldn't save rating — try again",
    );
  });
});

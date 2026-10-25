import { describe, expect, it } from "vitest";
import {
  halfAfterKey,
  halfStarLabel,
  heroRatingNote,
  householdRating,
  previewNote,
  ratingAfterClick,
  starsMeta,
} from "./rating";

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

describe("previewNote", () => {
  it("reads the value the pointer rests on", () => {
    expect(previewNote(3.5, 4)).toBe("Rate 3.5");
    expect(previewNote(5, null)).toBe("Rate 5");
  });

  it("offers to clear when the pointer rests on the saved value", () => {
    expect(previewNote(3.5, 3.5)).toBe("Clear your rating");
  });
});

describe("heroRatingNote", () => {
  it("says what you rated it", () => {
    expect(heroRatingNote(false, 4.5)).toBe("You rated it 4.5");
    expect(heroRatingNote(false, 3)).toBe("You rated it 3");
  });

  it("invites a first rating", () => {
    expect(heroRatingNote(false, null)).toBe("Not rated yet");
  });

  it("puts a refused save before everything else", () => {
    expect(heroRatingNote(true, 4)).toBe(
      "Couldn’t save your rating — try again",
    );
  });
  it("claims nothing while your rating is unknown", () => {
    expect(heroRatingNote(false, null, "loading")).toBe("Loading your rating…");
    expect(heroRatingNote(false, null, "failed")).toBe(
      "Couldn’t load your rating",
    );
  });
});

describe("halfAfterKey", () => {
  it.each([
    ["ArrowRight", 3, 3.5],
    ["ArrowUp", 3, 3.5],
    ["ArrowLeft", 3, 2.5],
    ["ArrowDown", 3, 2.5],
    ["Home", 3, 0.5],
    ["End", 3, 5],
  ])("moves %s from %s to %s", (key, from, to) => {
    expect(halfAfterKey(from, key)).toBe(to);
  });

  it.each([
    ["ArrowRight", 5],
    ["ArrowLeft", 0.5],
  ])("stays put on %s at %s", (key, from) => {
    expect(halfAfterKey(from, key)).toBeNull();
  });

  it("ignores any other key", () => {
    expect(halfAfterKey(3, "a")).toBeNull();
  });
});

describe("householdRating", () => {
  it("averages every readers stars", () => {
    expect(householdRating([4, 3, 5])).toEqual({ average: 4, count: 3 });
  });

  it("leaves out a reader who gave no stars", () => {
    expect(householdRating([null, 4.5, 3])).toEqual({
      average: 3.75,
      count: 2,
    });
  });

  it("is null while nobody has rated", () => {
    expect(householdRating([null, null])).toBeNull();
  });
});

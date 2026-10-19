import { describe, expect, it } from "vitest";
import {
  audioOnly,
  avgStarsValue,
  buildTiles,
  comparison,
  countComparison,
  durationValue,
  fillPct,
  pagesValue,
  percentComparison,
  starsComparison,
} from "./tiles";

type Summary = Parameters<typeof buildTiles>[0];

const NO_PAGES = {
  audio_books: 0,
  daily: [],
  measured_books: 0,
  since_day: null,
  unmeasured_books: 0,
  window_predates_ledger: false,
};

function summary(over: Partial<Summary>): Summary {
  return {
    range: "month",
    books_finished: 0,
    pages_read: null,
    listening_seconds: 0,
    avg_stars: null,
    pages_detail: NO_PAGES,
    previous: {
      books_finished: 0,
      avg_stars: null,
      listening_seconds: 0,
      pages_read: 0,
    },
    ...over,
  };
}

describe("durationValue", () => {
  it("scales minutes, decimal hours and whole hours", () => {
    expect(durationValue(0)).toEqual({ value: "0", unit: "min" });
    expect(durationValue(42 * 60)).toEqual({ value: "42", unit: "min" });
    expect(durationValue(3 * 3600 + 1800)).toEqual({
      value: "3.5",
      unit: "hours",
    });
    expect(durationValue(142 * 3600 + 120)).toEqual({
      value: "142",
      unit: "hours",
    });
  });
});

describe("avgStarsValue", () => {
  // `{:.1}` alone would settle 4.25 on 4.2; the tile rounds half away from zero first.
  it("rounds half up to one decimal, or shows an em-dash", () => {
    expect(avgStarsValue(4.25)).toBe("4.3");
    expect(avgStarsValue(4.24)).toBe("4.2");
    expect(avgStarsValue(5)).toBe("5.0");
    expect(avgStarsValue(null)).toBe("—");
  });
});

describe("pagesValue", () => {
  it("groups thousands or shows an em-dash", () => {
    expect(pagesValue(0, false)).toBe("0");
    expect(pagesValue(214, false)).toBe("214");
    expect(pagesValue(9214, false)).toBe("9,214");
    expect(pagesValue(1_234_567, false)).toBe("1,234,567");
    expect(pagesValue(null, false)).toBe("—");
  });

  // Listening turns no pages, which the tile can state; an em-dash would claim the server doesn't know.
  it("reads an audio-only window as zero, not as unknown", () => {
    expect(pagesValue(null, true)).toBe("0");
    expect(pagesValue(31, true)).toBe("31");
  });
});

describe("audioOnly", () => {
  it("is true only for listening with no reading at all", () => {
    expect(audioOnly({ ...NO_PAGES, audio_books: 2 })).toBe(true);
    expect(audioOnly(NO_PAGES)).toBe(false);
    expect(audioOnly({ ...NO_PAGES, audio_books: 2, measured_books: 1 })).toBe(
      false,
    );
    expect(
      audioOnly({ ...NO_PAGES, audio_books: 2, unmeasured_books: 1 }),
    ).toBe(false);
  });
});

describe("fillPct", () => {
  it("reaches the baseline and pegs once past it", () => {
    expect(fillPct(0, 100)).toBe(0);
    expect(fillPct(50, 100)).toBe(50);
    expect(fillPct(100, 100)).toBe(100);
    expect(fillPct(400, 100)).toBe(100);
  });

  it("fills a figure with no baseline and leaves an absence empty", () => {
    expect(fillPct(9, 0)).toBe(100);
    expect(fillPct(0, 0)).toBe(0);
  });
});

describe("countComparison", () => {
  it("states whole units and names a flat window", () => {
    expect(countComparison(6, 4).label).toBe("+2");
    expect(countComparison(3, 4).label).toBe("−1");
    expect(countComparison(4, 4).label).toBe("flat");
    expect(countComparison(6, 4).direction).toBe("up");
    expect(countComparison(3, 4).direction).toBe("down");
    expect(countComparison(4, 4).direction).toBe("flat");
  });
});

describe("percentComparison", () => {
  it("scales the change and calls an empty baseline new", () => {
    expect(percentComparison(118, 100).label).toBe("+18%");
    expect(percentComparison(94, 100).label).toBe("−6%");
    expect(percentComparison(31, 0).label).toBe("new");
  });

  it("calls under half a percent flat, and nothing on either side flat rather than new", () => {
    expect(percentComparison(100.4, 100).label).toBe("flat");
    expect(percentComparison(0, 0).label).toBe("flat");
  });
});

describe("starsComparison", () => {
  // A ratio between the two means would peg the bar at full for a window that rated as well as the last.
  it("draws against the five-star ceiling, not the last window", () => {
    expect(starsComparison(4, 4)).toEqual({
      label: "flat",
      direction: "flat",
      fillPct: 80,
    });
    expect(starsComparison(4.3, 4.1)).toMatchObject({
      label: "+0.2",
      direction: "up",
    });
    expect(starsComparison(3.9, 4.1)).toMatchObject({
      label: "−0.2",
      direction: "down",
    });
  });

  it("settles a half-way star change on the even decimal, as Rust formats it", () => {
    expect(starsComparison(4.5, 4.25)?.label).toBe("+0.2");
    expect(starsComparison(4.25, 4.5)?.label).toBe("−0.2");
  });

  it("is absent without a mean to report, and new without a baseline", () => {
    expect(starsComparison(null, 4)).toBeNull();
    expect(starsComparison(4, null)?.label).toBe("new");
  });
});

describe("buildTiles", () => {
  it("lists the four tiles in reading order, the first accented", () => {
    const tiles = buildTiles(summary({ books_finished: 3 }));

    expect(tiles.map((t) => [t.label, t.testid, t.metric, t.accent])).toEqual([
      ["Finished", "stats-tile-finished", "finished", true],
      ["Pages read", "stats-tile-pages", "pages", false],
      ["Listening", "stats-tile-listening", "listening", false],
      ["How you rated", "stats-tile-avg-rating", "avg_rating", false],
    ]);
    expect(tiles[0]).toMatchObject({ value: "3", unit: "books" });
  });

  // "— ★ avg" reads as a measured value of nothing; the bare dash reads as the absence it is.
  it("drops the star unit when nothing was rated", () => {
    const [, , , unrated] = buildTiles(summary({ avg_stars: null }));
    const [, , , rated] = buildTiles(summary({ avg_stars: 4.3 }));

    expect(unrated).toMatchObject({ value: "—", unit: "" });
    expect(rated).toMatchObject({ value: "4.3", unit: "★ avg" });
  });

  // `previous` is zero for Lifetime, so a delta drawn against it would report a whole history as new.
  it("drops every comparison on Lifetime", () => {
    const tiles = buildTiles(
      summary({
        range: "all_time",
        books_finished: 264,
        avg_stars: 4.1,
        listening_seconds: 3_600,
        pages_read: 92_410,
      }),
    );

    expect(tiles.every((t) => t.comparison === null)).toBe(true);
    expect(tiles[0]?.value).toBe("264");
    expect(tiles[1]?.value).toBe("92,410");
  });

  it("compares every metric on a bounded window", () => {
    const tiles = buildTiles(
      summary({
        books_finished: 4,
        pages_read: 1_284,
        listening_seconds: 41_040,
        avg_stars: 4.3,
        pages_detail: { ...NO_PAGES, measured_books: 5 },
        previous: {
          books_finished: 2,
          pages_read: 1_088,
          listening_seconds: 43_660,
          avg_stars: 4.3,
        },
      }),
    );

    expect(tiles.map((t) => t.comparison?.label)).toEqual([
      "+2",
      "+18%",
      "−6%",
      "flat",
    ]);
  });
});

describe("comparison", () => {
  // `null` is "nothing measurable happened", which against a real baseline is a fall to zero.
  it("reads an unmeasured pages window as a drop to zero", () => {
    const c = comparison(
      "pages",
      summary({ previous: { ...summary({}).previous, pages_read: 200 } }),
    );

    expect(c).toMatchObject({ label: "−100%", direction: "down" });
  });
});

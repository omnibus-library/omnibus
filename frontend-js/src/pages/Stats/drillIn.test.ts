import { describe, expect, it } from "vitest";
import {
  buildHistogramBars,
  buildRatingTrendBars,
  buildTrendBars,
  cutoverLine,
  measuredLine,
  predatesLedger,
  rateValue,
  ratingTrendCaption,
  shortDay,
  shortMonth,
  starLabel,
  trendBars,
  trendTitle,
  unmeasuredLine,
} from "./drillIn";

const bucket = (half_stars: number, books: number) => ({ half_stars, books });
const month = (label: string, value: number) => ({ label, value });

describe("buildTrendBars", () => {
  it("scales to the tallest point and stays zero when nothing happened", () => {
    const bars = buildTrendBars([
      ["A", 0],
      ["B", 2],
      ["C", 4],
    ]);

    expect(bars.map((b) => b.heightPct)).toEqual([0, 50, 100]);
    expect(buildTrendBars([["A", 0]])[0]?.heightPct).toBe(0);
  });
});

describe("starLabel", () => {
  it("renders buckets in stars, never in half-stars", () => {
    expect(starLabel(bucket(1, 0))).toBe("0.5");
    expect(starLabel(bucket(2, 0))).toBe("1");
    expect(starLabel(bucket(7, 0))).toBe("3.5");
    expect(starLabel(bucket(10, 0))).toBe("5");
  });
});

describe("buildHistogramBars", () => {
  const bars = buildHistogramBars([bucket(1, 1), bucket(2, 0), bucket(10, 4)]);

  it("normalizes counts and titles each bar with its total", () => {
    expect(bars.map((b) => b.heightPct)).toEqual([25, 0, 100]);
    expect(bars.map((b) => b.title)).toEqual([
      "0.5 ★ · 1 book",
      "1 ★ · 0 books",
      "5 ★ · 4 books",
    ]);
  });

  it("prints each count and leaves an empty bucket an empty slot", () => {
    expect(bars.map((b) => b.value)).toEqual(["1", null, "4"]);
    expect(bars.map((b) => b.empty)).toEqual([false, true, false]);
  });
});

describe("buildRatingTrendBars", () => {
  it("draws each month on a five-star scale with its figure", () => {
    const bars = buildRatingTrendBars([
      month("2026-06", 2.5),
      month("2026-07", 0),
      month("2026-08", 5),
      month("2026-09", 4.25),
    ]);

    // A 2.5 is half height even beside a 5: the bar is the rating, not a share of the best month.
    expect(bars.map((b) => b.heightPct)).toEqual([50, 0, 100, 85]);
    expect(bars.map((b) => b.value)).toEqual(["2.5", null, "5.0", "4.3"]);
    expect(bars[3]?.title).toBe("Sep 2026 · 4.3 ★");
    // A month nobody rated is an empty slot, never a stub.
    expect(bars.map((b) => b.empty)).toEqual([false, true, false, false]);
    expect(bars[1]?.title).toBe("Jul 2026 · no ratings");
  });

  it("never repeats an axis label across twelve months", () => {
    const year = Array.from({ length: 12 }, (_, i) => {
      const [y, m] = i < 3 ? [2025, 10 + i] : [2026, i - 2];
      return month(`${y}-${String(m).padStart(2, "0")}`, 4);
    });

    expect(buildRatingTrendBars(year).map((b) => b.label)).toEqual([
      "Oct",
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
    ]);
  });
});

describe("ratingTrendCaption", () => {
  it("names its trailing span and that it ignores the switcher", () => {
    expect(ratingTrendCaption([month("2025-10", 4), month("2026-09", 3)])).toBe(
      "Oct 2025 – Sep 2026 · the last 12 months, whatever period is selected",
    );
    expect(ratingTrendCaption([])).toBe(
      "The last 12 months, whatever period is selected",
    );
  });
});

describe("trendTitle", () => {
  it("is carried by the rating trend alone", () => {
    expect(trendTitle("avg_rating")).toBe("Average rating by month");
    for (const metric of ["finished", "listening", "pages"] as const) {
      expect(trendTitle(metric)).toBeNull();
    }
  });
});

describe("shortMonth and shortDay", () => {
  it("fall back on malformed input", () => {
    expect(shortMonth("2026-07")).toBe("Jul");
    expect(shortMonth("2026-06")).toBe("Jun");
    expect(shortMonth("2026-13")).toBe("?");
    expect(shortMonth("garbage")).toBe("?");
    expect(shortDay("2026-07-14")).toBe("14");
    expect(shortDay("garbage")).toBe("?");
  });
});

describe("trendBars", () => {
  const NONE = {
    books_per_month: [],
    rating_monthly: [],
    listening_daily: [],
    pages_detail: {
      audio_books: 0,
      daily: [],
      measured_books: 0,
      since_day: null,
      unmeasured_books: 0,
      window_predates_ledger: false,
    },
  };

  it("reads the per-day ledger for pages", () => {
    const bars = trendBars("pages", {
      ...NONE,
      pages_detail: {
        ...NONE.pages_detail,
        daily: [
          { label: "2026-08-03", value: 41 },
          { label: "2026-08-04", value: 12 },
        ],
      },
    });

    expect(bars.map((b) => [b.label, b.heightPct])).toEqual([
      ["03", 100],
      ["04", 29],
    ]);
  });

  it("reads books a month for finished and minutes a day for listening", () => {
    const finished = trendBars("finished", {
      ...NONE,
      books_per_month: [
        { month: "2026-07", books: 1 },
        { month: "2026-08", books: 4 },
      ],
    });
    const listening = trendBars("listening", {
      ...NONE,
      listening_daily: [
        { day: "2026-08-12", seconds: 1800 },
        { day: "2026-08-13", seconds: 3600 },
      ],
    });

    expect(finished.map((b) => [b.label, b.heightPct])).toEqual([
      ["Jul", 25],
      ["Aug", 100],
    ]);
    expect(listening.map((b) => [b.label, b.heightPct])).toEqual([
      ["12", 50],
      ["13", 100],
    ]);
  });

  it("puts the rating trend on its own scale", () => {
    const bars = trendBars("avg_rating", {
      ...NONE,
      rating_monthly: [month("2026-08", 4)],
    });

    expect(bars[0]).toMatchObject({ heightPct: 80, value: "4.0" });
  });
});

describe("rateValue", () => {
  // Rounds half up like the tile's mean; `{:.1}` alone would give 4.2 here.
  it("keeps a decimal only below ten pages an hour", () => {
    expect(rateValue(4.25)).toBe("4.3");
    expect(rateValue(9.94)).toBe("9.9");
    expect(rateValue(32.4)).toBe("32");
    expect(rateValue(32.6)).toBe("33");
  });

  // One decimal would read "10.0", which isn't "under ten" however it got there.
  it("branches on the rounded figure", () => {
    expect(rateValue(9.96)).toBe("10");
  });
});

describe("measuredLine", () => {
  it("singularizes a one-book window", () => {
    expect(measuredLine(1)).toBe("Across 1 book this period.");
    expect(measuredLine(4)).toBe("Across 4 books this period.");
  });
});

describe("unmeasuredLine", () => {
  it("names the books the total leaves out", () => {
    expect(unmeasuredLine(1, true)).toMatch(/^1 more book has/);
    expect(unmeasuredLine(3, true)).toMatch(/^3 more books have/);
  });

  // With nothing measured the line above says so: "more" has no antecedent, and the singular needs "it".
  it("drops 'more' when nothing was measured", () => {
    expect(unmeasuredLine(1, false)).toBe(
      "1 book has no known length yet, so nothing it contributed is counted.",
    );
    expect(unmeasuredLine(3, false)).toMatch(/^3 books have/);
    expect(unmeasuredLine(3, false)).toMatch(
      /nothing they contributed is counted\.$/,
    );
  });
});

describe("cutoverLine", () => {
  // A window after the epoch is fully covered, so the date is context; one reaching past it must say it is partial.
  it("warns only when the window reaches past the epoch", () => {
    expect(cutoverLine("2026-08-01", false)).toBe(
      "Page tracking began 2026-08-01.",
    );
    expect(cutoverLine("2026-08-01", true)).toContain("only partly covered");
  });
});

describe("predatesLedger", () => {
  const detail = {
    audio_books: 0,
    daily: [],
    measured_books: 0,
    unmeasured_books: 0,
  };

  it("follows the server's overlap answer, not the range", () => {
    expect(
      predatesLedger({
        ...detail,
        since_day: "2026-08-01",
        window_predates_ledger: true,
      }),
    ).toBe(true);
    expect(
      predatesLedger({
        ...detail,
        since_day: "2026-08-01",
        window_predates_ledger: false,
      }),
    ).toBe(false);
  });

  it("has nothing to warn about without a recorded epoch", () => {
    expect(
      predatesLedger({
        ...detail,
        since_day: null,
        window_predates_ledger: true,
      }),
    ).toBe(false);
  });
});

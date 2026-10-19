import { describe, expect, it } from "vitest";
import { changedUpdates, GoalsSchema, saveSummary } from "./goals";

describe("GoalsSchema", () => {
  it("reads whole numbers and an empty draft as targets and none", () => {
    expect(GoalsSchema.parse(["24", "", " 30 "])).toEqual([24, null, 30]);
  });

  it.each([
    ["a fraction", "1.5", "Enter a whole number of books."],
    ["text", "many", "Enter a whole number of books."],
    ["zero", "0", "Pick a target between 1 and 10000."],
    ["one past the maximum", "10001", "Pick a target between 1 and 10000."],
  ])("refuses %s", (_condition, draft, message) => {
    const result = GoalsSchema.safeParse([draft, "", ""]);

    expect(result.error?.issues).toMatchObject([{ path: [0], message }]);
  });

  it("accepts the maximum", () => {
    expect(GoalsSchema.parse(["10000", "2000", "1440"])).toEqual([
      10000, 2000, 1440,
    ]);
  });

  it("bounds each goal by its own maximum", () => {
    const result = GoalsSchema.safeParse(["", "2001", "1441"]);

    expect(result.error?.issues.map((i) => i.message)).toEqual([
      "Pick a target between 1 and 2000.",
      "Pick a target between 1 and 1440.",
    ]);
  });
});

describe("changedUpdates", () => {
  it("lists only the goals that moved, clears included", () => {
    expect(changedUpdates([24, null, 45], [24, 30, null])).toEqual([
      { index: 1, target: null },
      { index: 2, target: 45 },
    ]);
  });

  it("lists nothing when no goal moved", () => {
    expect(changedUpdates([24, null, null], [24, null, null])).toEqual([]);
  });
});

describe("saveSummary", () => {
  it("confirms a save that landed whole", () => {
    expect(saveSummary([])).toEqual({ message: "Goals saved.", error: false });
  });

  it("names the one goal that did not land", () => {
    expect(saveSummary(["Pages a day"])).toEqual({
      message: "Saved, except Pages a day — try that one again.",
      error: true,
    });
  });

  it("names both goals that did not land", () => {
    expect(saveSummary(["Pages a day", "Minutes a day"]).message).toBe(
      "Saved, except Pages a day and Minutes a day — try those again.",
    );
  });
});

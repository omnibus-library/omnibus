import { describe, expect, it } from "vitest";
import { changedUpdates, GoalsSchema, saveSummary } from "./goals";

describe("GoalsSchema", () => {
  it("reads whole numbers and an empty draft as targets and none", () => {
    expect(
      GoalsSchema.parse({ books: "24", pages: "", minutes: " 30 " }),
    ).toEqual({
      books: 24,
      pages: null,
      minutes: 30,
    });
  });

  it.each([
    ["a fraction", "1.5", "Enter a whole number of books."],
    ["text", "many", "Enter a whole number of books."],
    ["zero", "0", "Pick a target between 1 and 10000."],
    ["one past the maximum", "10001", "Pick a target between 1 and 10000."],
  ])("refuses %s", (_condition, draft, message) => {
    const result = GoalsSchema.safeParse({
      books: draft,
      pages: "",
      minutes: "",
    });

    expect(result.error?.issues).toMatchObject([{ path: ["books"], message }]);
  });

  it("accepts the maximum", () => {
    expect(
      GoalsSchema.parse({ books: "10000", pages: "2000", minutes: "1440" }),
    ).toEqual({ books: 10000, pages: 2000, minutes: 1440 });
  });

  it("bounds each goal by its own maximum", () => {
    const result = GoalsSchema.safeParse({
      books: "",
      pages: "2001",
      minutes: "1441",
    });

    expect(result.error?.issues.map((i) => i.message)).toEqual([
      "Pick a target between 1 and 2000.",
      "Pick a target between 1 and 1440.",
    ]);
  });
});

describe("changedUpdates", () => {
  it("lists only the goals that moved, clears included", () => {
    expect(
      changedUpdates(
        { books: 24, pages: null, minutes: 45 },
        { books: 24, pages: 30, minutes: null },
      ),
    ).toEqual([
      { kind: "pages", target: null },
      { kind: "minutes", target: 45 },
    ]);
  });

  it("lists nothing when no goal moved", () => {
    const same = { books: 24, pages: null, minutes: null };

    expect(changedUpdates(same, same)).toEqual([]);
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

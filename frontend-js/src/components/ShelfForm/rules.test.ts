import { describe, expect, it } from "vitest";
import type { ShelfRule } from "../../api/generated/schemas";
import {
  accepts,
  BLANK_DRAFT,
  fromRule,
  kindLabel,
  previewRequest,
  previewState,
  type RuleDraft,
  ruleText,
  toRule,
  visibilityLabel,
  withField,
} from "./rules";

const draft = (overrides: Partial<RuleDraft>): RuleDraft => ({
  ...BLANK_DRAFT,
  ...overrides,
});

describe("accepts", () => {
  it.each([
    ["tag", "contains", true],
    ["tag", "gte", false],
    ["rating", "gte", true],
    ["rating", "contains", false],
    ["status", "is", true],
    ["status", "is_not", false],
    ["format", "includes", true],
    ["format", "is", false],
    ["year", "is", true],
    ["date_added", "in_last", true],
    ["date_updated", "is", false],
  ] as const)("answers %s with %s as %s", (field, op, expected) => {
    expect(accepts(field, op)).toBe(expected);
  });
});

describe("toRule", () => {
  it("trims a plain value", () => {
    expect(toRule(draft({ value: "  Fantasy " }))).toEqual({
      field: "tag",
      op: "is",
      value: "Fantasy",
    });
  });

  it("encodes in_last as the number then the unit", () => {
    expect(
      toRule(
        draft({ field: "date_added", op: "in_last", value: "30", unit: "w" }),
      )?.value,
    ).toBe("30w");
  });

  it("encodes between as two dates", () => {
    expect(
      toRule(
        draft({
          field: "date_added",
          op: "between",
          value: "2025-01-01",
          value2: "2025-02-01",
        }),
      )?.value,
    ).toBe("2025-01-01..2025-02-01");
  });

  it.each([
    ["a blank value", draft({ value: "  " })],
    [
      "a between missing its end",
      draft({ field: "date_added", op: "between", value: "2025-01-01" }),
    ],
  ])("returns null for %s", (_condition, incomplete) => {
    expect(toRule(incomplete)).toBeNull();
  });
});

describe("fromRule", () => {
  it.each([
    ["a plain value", { field: "tag", op: "is", value: "Fantasy" }],
    ["an in_last window", { field: "date_added", op: "in_last", value: "30d" }],
    [
      "a between range",
      { field: "date_added", op: "between", value: "2025-01-01..2025-02-01" },
    ],
  ] as const satisfies readonly [string, ShelfRule][])(
    "round-trips %s through toRule",
    (_condition, rule) => {
      expect(toRule(fromRule(rule))).toEqual(rule);
    },
  );

  it("splits an in_last window into its number and unit", () => {
    expect(
      fromRule({ field: "date_added", op: "in_last", value: "30d" }),
    ).toMatchObject({ value: "30", unit: "d" });
  });

  it("splits a between range into its two dates", () => {
    expect(
      fromRule({
        field: "date_added",
        op: "between",
        value: "2025-01-01..2025-02-01",
      }),
    ).toMatchObject({ value: "2025-01-01", value2: "2025-02-01" });
  });
});

describe("withField", () => {
  it("keeps an op the new field accepts", () => {
    expect(withField(draft({ op: "contains" }), "author").op).toBe("contains");
  });

  it("snaps to the first op the new field accepts", () => {
    expect(withField(draft({ op: "contains" }), "rating").op).toBe("is");
    expect(withField(draft({ op: "is" }), "date_added").op).toBe("in_last");
  });

  it("seeds Status with finished unless it already holds a status", () => {
    expect(withField(draft({ value: "Fantasy" }), "status").value).toBe(
      "finished",
    );
    expect(withField(draft({ value: "unread" }), "status").value).toBe(
      "unread",
    );
  });
});

describe("previewState", () => {
  it.each([
    [false, true, false, "noRules"],
    [true, true, true, "pending"],
    [true, false, true, "failed"],
    [true, false, false, "settled"],
  ] as const)(
    "reads rules %s, fetching %s, failed %s as %s",
    (has, fetching, failed, state) => {
      expect(previewState(has, fetching, failed)).toBe(state);
    },
  );
});

describe("previewRequest", () => {
  it("sends the match mode and only the complete rules", () => {
    expect(
      previewRequest("all", [draft({ value: "Fantasy" }), draft({})]),
    ).toEqual({
      match_mode: "all",
      rules: [{ field: "tag", op: "is", value: "Fantasy" }],
    });
  });
});

describe("labels", () => {
  it("reads a rule as field, op and value", () => {
    expect(ruleText({ field: "tag", op: "is", value: "Fantasy" })).toBe(
      "Tag is Fantasy",
    );
    expect(ruleText({ field: "rating", op: "gte", value: "4" })).toBe(
      "Rating is at least 4",
    );
  });

  it("names the kinds and visibilities", () => {
    expect(kindLabel("smart")).toBe("Smart shelf");
    expect(kindLabel("manual")).toBe("Hand-picked shelf");
    expect(kindLabel("wishlist")).toBe("Wishlist");
    expect(visibilityLabel("private")).toBe("Private");
    expect(visibilityLabel("public")).toBe("Public");
  });
});

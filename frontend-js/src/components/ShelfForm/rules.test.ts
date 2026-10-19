import { describe, expect, it } from "vitest";
import { toBook } from "../../api";
import type { ShelfRule } from "../../api/generated/schemas";
import { aWireBook, uuidOf } from "../../testing/wire";
import {
  accepts,
  BLANK_DRAFT,
  createRequest,
  fromRule,
  kindLabel,
  previewRequest,
  previewState,
  type RuleDraft,
  ruleText,
  toRule,
  updateRequest,
  visibilityLabel,
  withField,
} from "./rules";

const aBook = (n: number) =>
  toBook(aWireBook({ id: n, unique_identifier: uuidOf(n) }));

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

describe("createRequest", () => {
  it("sends a smart shelf's complete rules and no books", () => {
    expect(
      createRequest({
        kind: "smart",
        name: "Cosy",
        visibility: "private",
        matchMode: "all",
        drafts: [draft({ value: "Fantasy" }), draft({})],
      }),
    ).toEqual({
      kind: "smart",
      name: "Cosy",
      visibility: "private",
      match_mode: "all",
      rules: [{ field: "tag", op: "is", value: "Fantasy" }],
      book_uuids: [],
    });
  });

  it("sends a hand-picked shelf's books and no rules", () => {
    const [a, b] = [aBook(1), aBook(2)];

    expect(
      createRequest({
        kind: "manual",
        name: "Mine",
        visibility: "public",
        picked: [a, b],
      }),
    ).toEqual({
      kind: "manual",
      name: "Mine",
      visibility: "public",
      match_mode: null,
      rules: [],
      book_uuids: [a.uuid, b.uuid],
    });
  });
});

describe("updateRequest", () => {
  const form = {
    name: " Cosy ",
    visibility: "public" as const,
    syncToKobo: true,
    smart: { matchMode: "any" as const, drafts: [draft({ value: "Fantasy" })] },
  };

  it("trims the name and sends the Kobo flag, match mode and rules", () => {
    expect(updateRequest(form)).toEqual({
      request: {
        name: "Cosy",
        visibility: "public",
        sync_to_kobo: true,
        match_mode: "any",
        rules: [{ field: "tag", op: "is", value: "Fantasy" }],
      },
    });
  });

  it("leaves out the Kobo flag and rules for a shelf with neither", () => {
    expect(updateRequest({ ...form, syncToKobo: null, smart: null })).toEqual({
      request: { name: "Cosy", visibility: "public" },
    });
  });

  it("rejects a blank name before looking at the rules", () => {
    expect(
      updateRequest({
        ...form,
        name: "   ",
        smart: { ...form.smart, drafts: [] },
      }),
    ).toEqual({ error: "Name is required." });
  });

  it("rejects a smart shelf with no complete rule", () => {
    expect(
      updateRequest({
        ...form,
        smart: { matchMode: "any", drafts: [draft({})] },
      }),
    ).toEqual({ error: "Add at least one condition." });
  });
});

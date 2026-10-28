import { describe, expect, it } from "vitest";
import type { FilterClause, FilterField } from "../../api";
import { aShelf, userId } from "../../testing/books";
import { BLANK_DRAFT } from "../ShelfForm/rules";
import { saveAsShelf } from "./saveAsShelf";

const include = (field: FilterField, ...values: string[]): FilterClause => ({
  field,
  mode: "include",
  values,
});
const exclude = (field: FilterField, ...values: string[]): FilterClause => ({
  field,
  mode: "exclude",
  values,
});
const manyValues = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);

const viewer = userId(1);
const loaded = {
  data: [aShelf({ id: 5, name: "Cosmere" }), aShelf({ id: 3 })],
  isError: false,
};
const pending = { isError: false };

const seed = (...clauses: FilterClause[]) =>
  saveAsShelf(clauses, loaded, viewer);

describe("saveAsShelf", () => {
  it("turns a single-value include into one is condition and a format into includes", () => {
    const { drafts, matchMode } = seed(
      include("author", "Brandon Sanderson"),
      include("format", "epub"),
    );

    expect(matchMode).toBe("all");
    expect(drafts).toEqual([
      { ...BLANK_DRAFT, field: "author", op: "is", value: "Brandon Sanderson" },
      { ...BLANK_DRAFT, field: "format", op: "includes", value: "epub" },
    ]);
  });

  it("carries a sole multi-value include as one condition per value under any", () => {
    const { drafts, matchMode } = seed(include("tag", "Cozy", "Dark"));

    expect(matchMode).toBe("any");
    expect(drafts.map((d) => [d.field, d.op, d.value])).toEqual([
      ["tag", "is", "Cozy"],
      ["tag", "is", "Dark"],
    ]);
  });

  it("turns an exclude into one is_not condition per value under all", () => {
    const { drafts, matchMode } = seed(exclude("genre", "Horror", "Romance"));

    expect(matchMode).toBe("all");
    expect(drafts.map((d) => [d.field, d.op, d.value])).toEqual([
      ["genre", "is_not", "Horror"],
      ["genre", "is_not", "Romance"],
    ]);
  });

  it("carries single-value includes and excludes together under all", () => {
    const { drafts, matchMode } = seed(
      include("series", "Stormlight"),
      exclude("tag", "Dark"),
    );

    expect(matchMode).toBe("all");
    expect(drafts.map((d) => [d.field, d.op, d.value])).toEqual([
      ["series", "is", "Stormlight"],
      ["tag", "is_not", "Dark"],
    ]);
  });

  it("leaves out a shelf clause and an excluded format with their reasons", () => {
    const { drafts, note } = seed(
      include("shelf", "5"),
      exclude("format", "pdf"),
      include("tag", "Cozy"),
    );

    expect(drafts.map((d) => d.value)).toEqual(["Cozy"]);
    expect(note).toBe(
      "From your filters: Tag carried. Shelf · Cosmere left out, a shelf can't be a condition. Format · not PDF left out, a condition can't exclude a format.",
    );
  });

  it("leaves out a multi-value include next to another filter and carries the rest under all", () => {
    const { drafts, matchMode, note } = seed(
      include("tag", "Cozy", "Dark"),
      include("author", "Ada"),
    );

    expect(matchMode).toBe("all");
    expect(drafts.map((d) => d.value)).toEqual(["Ada"]);
    expect(note).toBe(
      "From your filters: Author carried. Tag · Cozy +1 left out, several values alongside another filter.",
    );
  });

  it("carries the first of several multi-value includes under any and leaves the others out", () => {
    const { drafts, matchMode, note } = seed(
      include("tag", "Cozy", "Dark"),
      include("genre", "Fantasy", "Mystery"),
      include("series", "Saga", "Epic"),
    );

    expect(matchMode).toBe("any");
    expect(drafts.map((d) => d.value)).toEqual(["Cozy", "Dark"]);
    expect(note).toBe(
      "From your filters: Tag carried. Genre · Fantasy +1 left out, several values alongside another filter. Series · Saga +1 left out, several values alongside another filter.",
    );
  });

  it("carries a clause that brings the conditions to exactly 50", () => {
    const { drafts } = seed(exclude("tag", ...manyValues(50)));

    expect(drafts).toHaveLength(50);
  });

  it("leaves out a clause that would bring the conditions to 51 and names the cap", () => {
    const { drafts, note } = seed(
      exclude("tag", ...manyValues(30)),
      exclude("author", ...manyValues(21)),
    );

    expect(drafts).toHaveLength(30);
    expect(note).toBe(
      "From your filters: Tag carried. Author · not v0 +20 left out, a shelf holds at most 50 conditions.",
    );
  });

  it("sets aside a clause over the cap before deciding the match mode", () => {
    const { drafts, matchMode, note } = seed(
      include("tag", ...manyValues(60)),
      include("genre", "Fantasy", "Mystery"),
    );

    expect(matchMode).toBe("any");
    expect(drafts.map((d) => d.value)).toEqual(["Fantasy", "Mystery"]);
    expect(note).toBe(
      "From your filters: Genre carried. Tag · v0 +59 left out, a shelf holds at most 50 conditions.",
    );
  });

  it("trims values, drops blank ones and ignores a clause with no usable value", () => {
    const { drafts, name, note } = seed(
      exclude("tag", "  Dark  ", " ", ""),
      include("author", "   "),
    );

    expect(drafts.map((d) => d.value)).toEqual(["Dark"]);
    expect(name).toBe("not Dark");
    expect(note).toBe("From your filters: Tag carried.");
  });

  it("names the shelf from the carried values in clause order", () => {
    const { name } = seed(
      include("author", "Brandon Sanderson"),
      include("format", "epub"),
      exclude("tag", "Dark"),
      include("shelf", "5"),
    );

    expect(name).toBe("Brandon Sanderson · EPUB · not Dark");
  });

  it("cuts a name over 120 characters to 119 plus an ellipsis", () => {
    const long = "é".repeat(121);

    expect(seed(include("author", long)).name).toBe(`${"é".repeat(119)}…`);
    expect(seed(include("author", "é".repeat(120))).name).toBe("é".repeat(120));
  });

  it("carries nothing and lists only what was left out when no clause can be carried", () => {
    const { drafts, name, note, matchMode } = seed(include("shelf", "5"));

    expect(drafts).toEqual([]);
    expect(name).toBe("");
    expect(matchMode).toBe("all");
    expect(note).toBe(
      "From your filters: Shelf · Cosmere left out, a shelf can't be a condition.",
    );
  });

  it("writes an ellipsis for a shelf name still pending", () => {
    const { note } = saveAsShelf([include("shelf", "5")], pending, viewer);

    expect(note).toBe(
      "From your filters: Shelf · … left out, a shelf can't be a condition.",
    );
  });
});

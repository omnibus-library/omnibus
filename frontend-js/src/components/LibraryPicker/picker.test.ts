import { describe, expect, it } from "vitest";
import type { Book } from "../../api";
import { toBook } from "../../api";
import { aWireBook, uuidOf } from "../../testing/wire";
import { emptyMessage, statusLine, toggled } from "./picker";

const aBook = (n: number): Book =>
  toBook(aWireBook({ id: n, unique_identifier: uuidOf(n) }));

const status = (overrides: Partial<Parameters<typeof statusLine>[0]>) =>
  statusLine({
    searching: false,
    reviewing: false,
    pickCount: 0,
    pending: false,
    shown: 0,
    total: null,
    ...overrides,
  });

describe("toggled", () => {
  it("appends a new pick and drops an existing one", () => {
    const [a, b] = [aBook(1), aBook(2)];

    const first = toggled([], a);
    const both = toggled(first, b);

    expect(first).toEqual([a]);
    expect(both).toEqual([a, b]);
    expect(toggled(both, a)).toEqual([b]);
  });
});

describe("statusLine", () => {
  it.each([
    ["the library size once loaded", { shown: 42, total: 42 }, "42 books"],
    ["one book", { shown: 1, total: 1 }, "1 book"],
    [
      "the whole library while a page is partial",
      { shown: 100, total: 2310 },
      "2310 books",
    ],
    [
      "only what it can see when no total came",
      { shown: 12, total: null },
      "12 books",
    ],
    ["a complete search", { searching: true, shown: 3, total: 3 }, "3 matches"],
    [
      "a capped search",
      { searching: true, shown: 50, total: 2310 },
      "Showing 50 of 2310 matches · narrow your search",
    ],
    ["counting", { pending: true }, "Counting…"],
    ["searching", { pending: true, searching: true }, "Searching…"],
    [
      "the picks under review",
      { reviewing: true, pickCount: 2, pending: true },
      "2 books picked",
    ],
    ["one pick", { reviewing: true, pickCount: 1 }, "1 book picked"],
  ])("reads %s", (_condition, overrides, line) => {
    expect(status(overrides)).toBe(line);
  });
});

describe("emptyMessage", () => {
  it.each([
    [
      "nothing picked",
      { reviewing: true, searching: false, query: "" },
      "Nothing picked yet.",
    ],
    [
      "no match",
      { reviewing: false, searching: true, query: "zzz" },
      "No books match “zzz”.",
    ],
    [
      "an empty library",
      { reviewing: false, searching: false, query: "" },
      "No books in your library yet.",
    ],
  ])("says so for %s", (_condition, state, message) => {
    expect(emptyMessage(state)).toBe(message);
  });
});

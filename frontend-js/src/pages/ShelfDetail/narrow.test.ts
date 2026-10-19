import { describe, expect, it } from "vitest";
import type { Book } from "../../api";
import { type FullList, type NarrowedList, rows } from "./narrow";

const books = (...titles: string[]) =>
  titles.map((title) => ({ title }) as Book);
const titles = (r: { books: Book[] }) => r.books.map((b) => b.title);

const full = (list: Book[], ready = true, errored = false): FullList => ({
  books: list,
  ready,
  errored,
});
const answered = (list?: Book[], failed = false): NarrowedList => ({
  books: list,
  failed,
});

describe("rows", () => {
  it("draws the full list when no filter is set", () => {
    const got = rows(false, full(books("a", "b")), answered());

    expect(titles(got)).toEqual(["a", "b"]);
    expect(got).toMatchObject({
      pending: false,
      errored: false,
      filteredOut: false,
    });
  });

  it("is pending until the full list first answers", () => {
    expect(rows(false, full([], false), answered()).pending).toBe(true);
  });

  it("is not pending once the full list failed, and draws nothing", () => {
    const got = rows(false, full(books("stale"), false, true), answered());

    expect(got).toMatchObject({
      pending: false,
      errored: true,
      unavailable: true,
    });
    expect(got.books).toEqual([]);
  });

  it("draws the narrowed list under a filter", () => {
    const got = rows(true, full(books("a", "b", "c")), answered(books("b")));

    expect(titles(got)).toEqual(["b"]);
    expect(got).toMatchObject({ pending: false, filteredOut: false });
  });

  it("is pending under a filter until the narrowed list lands, though the full list is on hand", () => {
    const got = rows(true, full(books("a", "b")), answered());

    expect(got).toMatchObject({ pending: true, filteredOut: false });
    expect(got.books).toEqual([]);
  });

  it("says the filter ruled every member out when the shelf holds books", () => {
    const got = rows(true, full(books("a", "b")), answered([]));

    expect(got).toMatchObject({ filteredOut: true, pending: false });
  });

  it("says the filter ruled everything out while the full list is unanswered", () => {
    expect(rows(true, full([], false), answered([])).filteredOut).toBe(true);
  });

  it("leaves an empty shelf to its own empty state under a filter", () => {
    const got = rows(true, full([]), answered([]));

    expect(got).toMatchObject({ filteredOut: false, pending: false });
  });

  it("reports a failed narrowed fetch as an error, not as a filtered-out shelf", () => {
    const got = rows(true, full(books("a")), answered(undefined, true));

    expect(got).toMatchObject({
      errored: true,
      filteredOut: false,
      pending: false,
      unavailable: true,
    });
  });

  it("reports a failed full list under a filter and still draws the narrowed answer", () => {
    const got = rows(true, full([], false, true), answered(books("a")));

    expect(got).toMatchObject({ errored: true, unavailable: false });
    expect(titles(got)).toEqual(["a"]);
  });
});

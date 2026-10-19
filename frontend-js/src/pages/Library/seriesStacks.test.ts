import { describe, expect, it } from "vitest";
import type { SeriesStack, StackState } from "../../api";
import { aBook, aStack } from "../../testing/books";
import {
  bandStyle,
  type GridItem,
  gridItems,
  isStale,
  itemKey,
  stackLeads,
  stackLeaves,
  stackSegments,
  volumeCaption,
} from "./seriesStacks";

const book = (uuid: string, index: string | null = null) =>
  aBook({
    uuid: uuid as ReturnType<typeof aBook>["uuid"],
    series: index === null ? null : { name: "Saga", index },
  });

const state = (
  uuid: string,
  started: boolean,
  finished: boolean,
  percent: number | null = null,
): StackState => ({ uuid, started, finished, percent });

const saga = (lead: string, members: string[], states: StackState[] = []) =>
  aStack({
    leadUuid: lead,
    members: members.map((u, i) => book(u, String(i + 1))),
    states,
  });

const labels = (items: GridItem[]) =>
  items.map((item) => {
    switch (item.kind) {
      case "book":
        return `book:${item.book.uuid}`;
      case "vol":
        return `vol:${item.volume.book.uuid}`;
      default:
        return `${item.kind}:${item.stack.leadUuid}`;
    }
  });

describe("gridItems", () => {
  it("puts a folded stack in its lead slot and leaves other books alone", () => {
    const books = [book("a"), book("s2", "2"), book("b")];

    expect(labels(gridItems(books, [saga("s2", ["s1", "s2"])], null))).toEqual([
      "book:a",
      "stack:s2",
      "book:b",
    ]);
  });

  it("deals an open stack out as a head card then its volumes in series order", () => {
    const books = [book("a"), book("s2", "2"), book("b")];
    const stacks = [saga("s2", ["s1", "s2", "s3"])];

    const items = gridItems(books, stacks, "s2");

    expect(labels(items)).toEqual([
      "book:a",
      "cap:s2",
      "vol:s1",
      "vol:s2",
      "vol:s3",
      "book:b",
    ]);
    expect(
      items.flatMap((i) => (i.kind === "vol" ? [i.volume.last] : [])),
    ).toEqual([false, false, true]);
  });

  it("shows a book for a one-member stack", () => {
    const books = [book("s1", "1")];

    expect(labels(gridItems(books, [saga("s1", ["s1"])], "s1"))).toEqual([
      "book:s1",
    ]);
  });

  it("ignores an open key no stack leads with", () => {
    const books = [book("s1", "1")];

    expect(
      labels(gridItems(books, [saga("s1", ["s1", "s2"])], "gone")),
    ).toEqual(["stack:s1"]);
  });
});

describe("itemKey", () => {
  it("names a book by its uuid and a stack or head card by its lead", () => {
    const stack = saga("s2", ["s1", "s2"]);
    const books = [book("a"), book("s2", "2")];

    expect(gridItems(books, [stack], "s2").map(itemKey)).toEqual([
      "a",
      "cap-s2",
      "s1",
      "s2",
    ]);
    expect(itemKey({ kind: "stack", stack })).toBe("stack-s2");
  });
});

describe("volumeCaption", () => {
  it("numbers by series index and marks a finished volume read", () => {
    const stack = saga(
      "s1",
      ["s1", "s2"],
      [state("s1", true, true), state("s2", true, false, 40)],
    );

    expect(volumeCaption(stack, book("s1", "1"), 0)).toBe("Vol. 1 · read");
    expect(volumeCaption(stack, book("s2", "2"), 1)).toBe("Vol. 2");
  });

  it("falls back to the run position without a series index", () => {
    expect(volumeCaption(saga("x", ["x", "y"]), book("y"), 1)).toBe("Vol. 2");
  });
});

describe("stackLeaves", () => {
  it("fans the in-progress volume first and caps at three", () => {
    const stack = saga(
      "s1",
      ["s1", "s2", "s3", "s4"],
      [state("s1", true, true), state("s3", true, false, 20)],
    );

    expect(stackLeaves(stack).map((b) => b.uuid)).toEqual(["s3", "s1", "s2"]);
  });
});

describe("stackSegments", () => {
  it("is null until a volume is started, then fills finished ones whole", () => {
    const fresh = saga("s1", ["s1", "s2", "s3"]);
    const started: SeriesStack = {
      ...fresh,
      states: [
        state("s1", true, true),
        state("s2", true, false, 40),
        state("s3", false, false),
      ],
    };

    expect(stackSegments(fresh)).toBeNull();
    expect(stackSegments(started)).toEqual([100, 40, 0]);
  });
});

describe("bandStyle", () => {
  it("tints with the front accent and falls back to the page accent", () => {
    const stack = saga("s1", ["s1", "s2"]);

    expect(bandStyle(stack)).toBe("oklch(0.555 0.153 28.4)");
    expect(
      bandStyle({ ...stack, members: [{ ...book("s1"), accent: null }] }),
    ).toBe("var(--accent)");
  });
});

describe("stackLeads", () => {
  it("names each stack the grid folds and skips a one-member one", () => {
    expect(stackLeads([saga("s1", ["s1", "s2"]), saga("x", ["x"])])).toEqual([
      "s1",
    ]);
  });
});

describe("isStale", () => {
  it("flags a key no current stack leads with", () => {
    expect(isStale("gone", ["s1"])).toBe(true);
    expect(isStale("s1", ["s1"])).toBe(false);
    expect(isStale(null, ["s1"])).toBe(false);
  });
});

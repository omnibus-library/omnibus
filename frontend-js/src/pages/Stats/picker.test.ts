import { describe, expect, it } from "vitest";
import { userId } from "../../testing/books";
import { aWireReader } from "../../testing/statsHandlers";
import { heading, showsPicker, viewing } from "./picker";

const YOU = aWireReader({ id: 1, name: "You", is_you: true });
const ALICE = aWireReader({ id: 2, name: "Alice", is_you: false });

describe("viewing", () => {
  it("resolves no selection and the caller's own id to you", () => {
    expect(viewing(null, [YOU, ALICE])).toEqual({ kind: "you" });
    expect(viewing(userId(1), [YOU, ALICE])).toEqual({ kind: "you" });
  });

  it("names a listed other reader", () => {
    expect(viewing(userId(2), [YOU, ALICE])).toEqual({
      kind: "reader",
      name: "Alice",
    });
  });

  // A stale link, or a reader who just turned sharing off, still needs somewhere to point.
  it("falls back to another reader for an id the list does not carry", () => {
    expect(viewing(userId(99), [YOU])).toEqual({
      kind: "reader",
      name: "Another reader",
    });
  });
});

describe("heading", () => {
  it("is none for you and the possessive for another reader", () => {
    expect(heading({ kind: "you" })).toBeNull();
    expect(heading({ kind: "reader", name: "Alice" })).toBe("Alice's stats");
  });
});

describe("showsPicker", () => {
  it("is false for only the caller or an empty list, true once another reader shares", () => {
    expect(showsPicker([])).toBe(false);
    expect(showsPicker([YOU])).toBe(false);
    expect(showsPicker([YOU, ALICE])).toBe(true);
  });
});

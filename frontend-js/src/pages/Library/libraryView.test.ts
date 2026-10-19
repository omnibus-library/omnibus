import { describe, expect, it } from "vitest";
import { emptyState, headerCount, hiddenFormatsLabel } from "./libraryView";

describe("emptyState", () => {
  it.each([
    [3, true, "none"],
    [3, false, "none"],
    [0, true, "filtered"],
    [0, false, "empty"],
  ] as const)("%i books, filtered %s is %s", (count, filtered, state) => {
    expect(emptyState(count, filtered)).toBe(state);
  });
});

describe("headerCount", () => {
  it("shows nothing without a filter, even with a total", () => {
    expect(headerCount(false, 12, false)).toBeNull();
  });

  it("says counting until the filtered list answers, never zero", () => {
    expect(headerCount(true, null, false)).toBe("counting");
  });

  it("shows the total once known", () => {
    expect(headerCount(true, 0, false)).toBe(0);
    expect(headerCount(true, 7, false)).toBe(7);
  });

  it("shows no count after a failure with no total, but keeps a known one", () => {
    expect(headerCount(true, null, true)).toBeNull();
    expect(headerCount(true, 7, true)).toBe(7);
  });
});

describe("hiddenFormatsLabel", () => {
  it("sorts and uppercases the hidden formats", () => {
    expect(hiddenFormatsLabel(["mp3", "m4b"])).toBe("Hidden: M4B, MP3");
  });

  it("is null when nothing is hidden", () => {
    expect(hiddenFormatsLabel([])).toBeNull();
  });
});

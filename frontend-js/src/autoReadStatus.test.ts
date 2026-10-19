import { describe, expect, it } from "vitest";
import { autoTransition } from "./autoReadStatus";

describe("autoTransition", () => {
  it.each([
    ["unread", false, "reading"],
    ["reading", false, null],
    ["finished", false, null],
    ["unread", true, "finished"],
    ["reading", true, "finished"],
    ["finished", true, null],
  ] as const)("moves %s at atEnd=%s to %s", (current, atEnd, next) => {
    expect(autoTransition(current, atEnd)).toBe(next);
  });
});

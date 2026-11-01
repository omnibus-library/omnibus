import { describe, expect, it } from "vitest";
import { isPlainClick } from "./plainClick";

const click = (over: Partial<Parameters<typeof isPlainClick>[0]> = {}) => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("isPlainClick", () => {
  it("is true for a bare primary-button click", () => {
    expect(isPlainClick(click())).toBe(true);
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["the middle button", { button: 1 }],
  ])("is false when %s is held", (_held, over) => {
    expect(isPlainClick(click(over))).toBe(false);
  });
});

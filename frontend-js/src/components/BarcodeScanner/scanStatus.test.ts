import { describe, expect, it } from "vitest";
import { isTerminal, parseScanStatus } from "./scanStatus";

describe("parseScanStatus", () => {
  it.each(["starting", "ready", "denied", "unsupported", "error"])(
    "reads %s",
    (state) => {
      expect(parseScanStatus(state)).toBe(state);
    },
  );

  it("reads a status it does not know as an error", () => {
    expect(parseScanStatus("exploded")).toBe("error");
  });
});

describe("isTerminal", () => {
  it("is true once the camera is out for good", () => {
    expect(
      ["denied", "unsupported", "error"].map((s) =>
        isTerminal(parseScanStatus(s)),
      ),
    ).toEqual([true, true, true]);
    expect(isTerminal("starting")).toBe(false);
    expect(isTerminal("ready")).toBe(false);
  });
});

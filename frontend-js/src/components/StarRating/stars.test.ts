import { describe, expect, it } from "vitest";
import { fillPercent, fmtStars } from "./stars";

describe("fillPercent", () => {
  it("half-fills the star a half rating lands on", () => {
    expect(fillPercent(4.5, 4)).toBe(100);
    expect(fillPercent(4.5, 5)).toBe(50);
    expect(fillPercent(4, 5)).toBe(0);
  });

  it("rounds a partial star down to the half below", () => {
    expect(fillPercent(4.9, 5)).toBe(50);
    expect(fillPercent(4.2, 5)).toBe(0);
  });
});

describe("fmtStars", () => {
  it.each([
    [4, "4"],
    [4.5, "4.5"],
    [0.5, "0.5"],
  ])("reads %f as %s", (stars, text) => {
    expect(fmtStars(stars)).toBe(text);
  });
});

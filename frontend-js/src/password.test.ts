import { describe, expect, it } from "vitest";
import { scorePassword } from "./password";

describe("scorePassword", () => {
  it("scores an empty password zero", () => {
    expect(scorePassword("")).toEqual({
      score: 0,
      label: "empty",
      rules: { length: false, mixedCase: false, numberOrSymbol: false },
    });
  });

  it.each([
    ["abcd", 1],
    ["AbCdEfGh", 3],
    ["AbCdEfGh1!2x", 4],
  ] as const)("scores %s as %i", (password, score) => {
    expect(scorePassword(password).score).toBe(score);
  });

  it.each([
    ["abcdefgh1", { length: false, mixedCase: false, numberOrSymbol: true }],
    ["abcdefghi1", { length: true, mixedCase: false, numberOrSymbol: true }],
    ["Ab", { length: false, mixedCase: true, numberOrSymbol: false }],
  ])("tracks each requirement at its threshold for %s", (password, rules) => {
    expect(scorePassword(password).rules).toEqual(rules);
  });

  it("calls a short password weak rather than empty", () => {
    expect(scorePassword("a").label).toBe("weak");
  });

  it("calls a password meeting every rule strong", () => {
    expect(scorePassword("AbCdEfGh1!2x").label).toBe("strong");
  });
});

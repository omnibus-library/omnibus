import { describe, expect, it } from "vitest";
import { minutesLeft } from "./impersonation";

const NOW = Date.parse("2026-01-01T12:00:00Z");
const inSeconds = (seconds: number) => NOW / 1000 + seconds;

describe("minutesLeft", () => {
  it("rounds a part minute up", () => {
    expect(minutesLeft(inSeconds(25 * 60 - 10), NOW)).toBe(25);
    expect(minutesLeft(inSeconds(61), NOW)).toBe(2);
  });

  it("never reads below one minute", () => {
    expect(minutesLeft(inSeconds(20), NOW)).toBe(1);
    expect(minutesLeft(inSeconds(-300), NOW)).toBe(1);
  });
});

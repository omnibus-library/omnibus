import { afterEach, describe, expect, it, vi } from "vitest";
import { localToUtcPrefix } from "./logs";

describe("localToUtcPrefix", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["UTC", "2026-07-19T10:30", "2026-07-19T10:30"],
    ["America/New_York", "2026-07-19T10:30", "2026-07-19T14:30"],
    ["Asia/Kolkata", "2026-07-19T00:10", "2026-07-18T18:40"],
    ["Pacific/Kiritimati", "2026-07-19T10:30", "2026-07-18T20:30"],
  ])("converts a %s wall-clock time to its UTC minute", (zone, local, utc) => {
    vi.stubEnv("TZ", zone);

    expect(localToUtcPrefix(local)).toBe(utc);
  });

  it("gives a 16-character prefix that names the same instant", () => {
    vi.stubEnv("TZ", "America/New_York");
    const local = "2026-01-05T23:45";

    const prefix = localToUtcPrefix(local);

    expect(prefix).toHaveLength(16);
    expect(Date.parse(`${prefix}:00Z`)).toBe(Date.parse(local));
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["not a date", "yesterday-ish"],
  ])("reads %s as null", (_condition, value) => {
    expect(localToUtcPrefix(value)).toBeNull();
  });
});

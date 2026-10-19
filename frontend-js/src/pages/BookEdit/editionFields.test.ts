import { describe, expect, it } from "vitest";
import type { ProviderSearchStatus } from "../../api/generated/schemas";
import { humanWait, sourceStatusText } from "./editionFields";

const source = (status: ProviderSearchStatus) => ({
  display_name: "Open Library",
  provider: "open_library" as const,
  status,
});

describe("humanWait", () => {
  it.each([
    [0, "1s"],
    [45, "45s"],
    [90, "90s"],
    [91, "2m"],
    [600, "10m"],
  ])("reads %d seconds as %s", (secs, text) => {
    expect(humanWait(secs)).toBe(text);
  });
});

describe("sourceStatusText", () => {
  it.each([
    [{ kind: "answered", count: 8 }, "8", false],
    [{ kind: "answered", count: 0 }, "nothing", false],
    [{ kind: "not_configured" }, "not set up", false],
    [{ kind: "failed", message: "timed out" }, "unavailable", true],
    [
      { kind: "throttled", retry_after_secs: 45 },
      "rate limited, skipping for 45s",
      true,
    ],
  ] satisfies [ProviderSearchStatus, string, boolean][])(
    "reads %j as %s",
    (status, text, problem) => {
      expect(sourceStatusText(source(status))).toMatchObject({ text, problem });
    },
  );

  it("carries a failure's own message as the detail", () => {
    expect(
      sourceStatusText(source({ kind: "failed", message: "timed out" })).detail,
    ).toBe("timed out");
  });
});

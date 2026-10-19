import { describe, expect, it } from "vitest";
import { mcpCommand, relDate, statusPill } from "./apiTokens";

const at = (iso: string) => Date.parse(iso) / 1000;
const NOW = at("2026-10-19T12:00:00Z");

describe("statusPill", () => {
  it("says a token that was never used so", () => {
    expect(statusPill(NOW, null)).toEqual({
      tone: "unused",
      label: "Never used",
    });
  });

  it("calls a token used a day ago active", () => {
    expect(statusPill(NOW, NOW - 86_400).label).toBe("Active");
  });

  it("keeps a token used exactly 30 days ago active", () => {
    expect(statusPill(NOW, NOW - 30 * 86_400)).toEqual({
      tone: "active",
      label: "Active",
    });
  });

  it("calls a token idle once it passes 30 days", () => {
    expect(statusPill(NOW, NOW - 30 * 86_400 - 1)).toEqual({
      tone: "idle",
      label: "Idle 30d",
    });
  });

  it("counts whole days of idleness", () => {
    expect(statusPill(NOW, NOW - 45.5 * 86_400).label).toBe("Idle 45d");
  });
});

describe("relDate", () => {
  it.each([
    ["earlier today", "2026-10-19T00:00:00Z", "today"],
    ["the previous UTC day", "2026-10-18T23:59:00Z", "yesterday"],
    ["two days ago", "2026-10-17T12:00:00Z", "2 days ago"],
    ["thirty days ago", "2026-09-19T12:00:00Z", "30 days ago"],
    ["thirty-one days ago", "2026-09-18T12:00:00Z", "18 Sep"],
    ["a year earlier", "2025-07-14T12:00:00Z", "14 Jul 2025"],
  ])("reads %s as %s", (_condition, iso, expected) => {
    expect(relDate(NOW, at(iso))).toBe(expected);
  });

  it("reads a moment in the future as today", () => {
    expect(relDate(NOW, NOW + 3 * 86_400)).toBe("today");
  });

  it("adds the year to a December date seen from January", () => {
    expect(
      relDate(at("2026-01-10T00:00:00Z"), at("2025-12-01T00:00:00Z")),
    ).toBe("1 Dec 2025");
  });
});

describe("mcpCommand", () => {
  it("embeds the origin and the bearer", () => {
    expect(mcpCommand("https://lib.example", "omni_abc")).toBe(
      'claude mcp add --transport http omnibus https://lib.example/mcp --header "Authorization: Bearer omni_abc"',
    );
  });
});

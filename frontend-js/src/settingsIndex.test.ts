import { describe, expect, it } from "vitest";
import {
  legacySettingsHref,
  matchingSettings,
  PERSONAL_SECTIONS,
  parseSettingsSection,
} from "./settingsIndex";

const labels = (query: string, isAdmin: boolean) =>
  matchingSettings(query, isAdmin).map((entry) => entry.label);

describe("matchingSettings", () => {
  it("finds a setting by keyword", () => {
    expect(labels("dark", false)).toEqual(["Theme"]);
  });

  it("ignores case", () => {
    expect(labels("KINDLE", false)).toEqual(["Send to Kindle"]);
  });

  it("offers server settings to admins", () => {
    expect(labels("smtp", true)).toEqual(["Email delivery (SMTP)"]);
  });

  it("hides server settings from members", () => {
    expect(labels("smtp", false)).toEqual([]);
  });

  it("returns nothing for a blank query", () => {
    expect(labels("   ", true)).toEqual([]);
  });

  it("returns at most five entries", () => {
    expect(labels("e", true)).toHaveLength(5);
  });
});

describe("parseSettingsSection", () => {
  it("lists the personal sections in sidebar order", () => {
    expect(PERSONAL_SECTIONS.map((s) => s.slug)).toEqual([
      "profile",
      "preferences",
      "goals",
      "devices",
      "security",
    ]);
  });

  it("returns the section a slug names", () => {
    expect(parseSettingsSection("goals").label).toBe("Goals");
  });

  it.each([
    ["no slug", null],
    ["an empty slug", ""],
    ["an unknown slug", "smtp"],
  ])("opens Profile for %s", (_condition, raw) => {
    expect(parseSettingsSection(raw).slug).toBe("profile");
  });
});

describe("legacySettingsHref", () => {
  it.each([
    ["account", "/settings?section=profile"],
    ["kindle", "/settings?section=devices"],
    ["kobo", "/settings?section=devices"],
    ["api-tokens", "/settings?section=security"],
    ["library", "/admin?section=sources"],
    ["metadata", "/admin?section=metadata"],
    ["email", "/admin?section=integrations"],
    ["cleanup", "/admin?section=cleanup"],
    ["users", "/admin?section=people"],
    ["health", "/admin?section=health"],
    ["background-tasks", "/admin?section=maintenance"],
    ["logs", "/admin?section=logs"],
  ])("sends %s to %s", (slug, href) => {
    expect(legacySettingsHref(slug)).toBe(href);
  });

  it.each([
    ["a current slug", "devices"],
    ["an unknown slug", "smtp"],
    ["an inherited property name", "constructor"],
  ])("returns null for %s", (_condition, slug) => {
    expect(legacySettingsHref(slug)).toBeNull();
  });
});

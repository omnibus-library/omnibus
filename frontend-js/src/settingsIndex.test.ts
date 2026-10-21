import { describe, expect, it } from "vitest";
import {
  ADMIN_SECTIONS,
  legacySettingsHref,
  matchingSettings,
  PERSONAL_SECTIONS,
  parseAdminSection,
  parseSettingsSection,
  sameSection,
} from "./settingsIndex";

const labels = (query: string, isAdmin: boolean) =>
  matchingSettings(query, isAdmin).map((entry) => entry.label);

/** The parts of a router location `sameSection` reads, for an in-app path. */
const at = (path: string) => {
  const url = new URL(path, "http://omnibus.test");
  return { pathname: url.pathname, search: url.search };
};

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

describe("parseAdminSection", () => {
  it("lists the admin sections in sidebar order under their groups", () => {
    expect(ADMIN_SECTIONS.map((s) => `${s.group}/${s.slug}`)).toEqual([
      "Library/sources",
      "Library/maintenance",
      "Library/metadata",
      "Library/cleanup",
      "Server/people",
      "Server/integrations",
      "Server/health",
      "Server/logs",
    ]);
  });

  it("returns the section a slug names", () => {
    expect(parseAdminSection("people").label).toBe("People");
  });

  it.each([
    ["no slug", null],
    ["an empty slug", ""],
    ["an unknown slug", "bogus"],
    ["a personal slug", "profile"],
  ])("opens Sources for %s", (_condition, raw) => {
    expect(parseAdminSection(raw).slug).toBe("sources");
  });
});

describe("sameSection", () => {
  it.each([
    [
      "a bare admin page and its first section",
      "/admin",
      "/admin?section=sources",
    ],
    [
      "an unknown admin slug and the first section",
      "/admin?section=bogus",
      "/admin?section=sources",
    ],
    [
      "a bare settings page and its first section",
      "/settings",
      "/settings?section=profile",
    ],
  ])("treats %s as one place", (_condition, from, to) => {
    expect(sameSection(at(from), at(to))).toBe(true);
  });

  it.each([
    ["two admin sections", "/admin?section=sources", "/admin?section=people"],
    ["two personal sections", "/settings", "/settings?section=goals"],
    [
      "one slug on two pages",
      "/admin?section=sources",
      "/settings?section=sources",
    ],
  ])("treats %s as different places", (_condition, from, to) => {
    expect(sameSection(at(from), at(to))).toBe(false);
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

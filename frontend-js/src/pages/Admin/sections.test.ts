import { describe, expect, it } from "vitest";
import { adminTitle, parseSection } from "./sections";

describe("parseSection", () => {
  it.each([
    "sources",
    "maintenance",
    "metadata",
    "cleanup",
    "people",
    "integrations",
    "health",
    "logs",
  ])("resolves the %s slug to its own section", (slug) => {
    expect(parseSection(slug).slug).toBe(slug);
  });

  it.each([
    ["a missing section", null],
    ["an unknown slug", "bogus"],
    ["an empty slug", ""],
  ])("opens sources for %s", (_condition, raw) => {
    expect(parseSection(raw).slug).toBe("sources");
  });
});

describe("adminTitle", () => {
  it("names the open section after the page", () => {
    expect(adminTitle("people")).toBe("People · Administration");
  });

  it("names sources for an unknown slug", () => {
    expect(adminTitle("bogus")).toBe("Sources · Administration");
  });
});

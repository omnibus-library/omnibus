import { describe, expect, it } from "vitest";
import html from "../index.html?raw";

describe("index.html", () => {
  it("names the stoat as the tab icon", () => {
    const page = new DOMParser().parseFromString(html, "text/html");

    expect(page.querySelector("link[rel=icon]")?.getAttribute("href")).toBe(
      "/src/assets/omnibus-stoat.png",
    );
  });

  it("draws the page loader in #root before the bundle runs", () => {
    const page = new DOMParser().parseFromString(html, "text/html");

    expect(
      page.querySelector(
        "#root .atrium .ld.ld-page[role=status] .ld-riffle.lg .ld-rf-book",
      ),
    ).not.toBeNull();
  });
});

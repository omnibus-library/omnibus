import { describe, expect, it } from "vitest";
import html from "../index.html?raw";

describe("index.html", () => {
  it("draws a loader in #root before the bundle runs", () => {
    const page = new DOMParser().parseFromString(html, "text/html");

    expect(page.querySelector("#root [role=status]")?.textContent).toContain(
      "Opening your library",
    );
  });
});

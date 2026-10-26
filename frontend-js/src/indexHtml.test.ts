import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import { Loading } from "./components/Loading/Loading";

const page = new DOMParser().parseFromString(html, "text/html");

describe("index.html", () => {
  it("names the stoat as the tab icon", () => {
    expect(page.querySelector("link[rel=icon]")?.getAttribute("href")).toBe(
      "/src/assets/omnibus-stoat.png",
    );
  });

  it("draws the markup of the signed-in gate's page loader", () => {
    const boot = page.querySelector("#root > .atrium > .ld")?.outerHTML;

    expect(boot?.replace(/>\s+</g, "><")).toBe(
      renderToStaticMarkup(
        createElement(Loading, { kind: "page", label: "Opening your library" }),
      ),
    );
  });
});

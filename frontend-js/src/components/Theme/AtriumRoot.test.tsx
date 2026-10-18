import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AtriumRoot } from "./AtriumRoot";

describe("AtriumRoot", () => {
  it("wears the theme the reader saved", () => {
    localStorage.setItem("omn.theme", "sepia");

    render(<AtriumRoot>page</AtriumRoot>);

    expect(screen.getByText("page")).toHaveAttribute("data-theme", "sepia");
  });

  it("falls back to dark for a theme it doesn't know", () => {
    localStorage.setItem("omn.theme", "neon");

    render(<AtriumRoot>page</AtriumRoot>);

    expect(screen.getByText("page")).toHaveAttribute("data-theme", "dark");
  });
});

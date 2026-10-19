import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemePicker } from "../ThemePicker/ThemePicker";
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

  it("switches to the theme a reader picks", async () => {
    render(
      <AtriumRoot>
        <ThemePicker />
      </AtriumRoot>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Sepia" }));

    expect(
      screen.getByRole("group", { name: "Theme" }).closest(".atrium"),
    ).toHaveAttribute("data-theme", "sepia");
  });

  it("saves the picked theme for the next visit", async () => {
    render(
      <AtriumRoot>
        <ThemePicker />
      </AtriumRoot>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(localStorage.getItem("omn.theme")).toBe("light");
  });

  describe("theme snap", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds transitions off while the palette flips", () => {
      render(
        <AtriumRoot>
          <ThemePicker />
        </AtriumRoot>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Black" }));

      expect(
        screen.getByRole("group", { name: "Theme" }).closest(".atrium"),
      ).toHaveClass("theme-snap");
    });

    it("lets transitions back on once the flip has painted", () => {
      vi.useFakeTimers();
      render(
        <AtriumRoot>
          <ThemePicker />
        </AtriumRoot>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Black" }));
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(
        screen.getByRole("group", { name: "Theme" }).closest(".atrium"),
      ).not.toHaveClass("theme-snap");
    });
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Button, ButtonLink } from "./Button";

describe("Button", () => {
  it("renders a non-submitting button by default", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it.each([
    ["the default look", {}, "btn"],
    [
      "a primary small button",
      { variant: "primary", size: "sm" },
      "btn primary sm",
    ],
    [
      "a screen's own modifier",
      { variant: "ghost", className: "x" },
      "btn ghost x",
    ],
  ] as const)("draws %s", (_case, look, expected) => {
    render(<Button {...look}>Save</Button>);

    expect(screen.getByRole("button")).toHaveAttribute("class", expected);
  });
});

describe("ButtonLink", () => {
  it("links to its destination drawn as a button", () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/settings" variant="ghost">
          Settings
        </ButtonLink>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAttribute("class", "btn ghost");
  });
});

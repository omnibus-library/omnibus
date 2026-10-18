import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PageError, PageNotFound } from "./PageState";

describe("PageError", () => {
  it("announces the failure as an alert", () => {
    render(<PageError message="Couldn't load the book" />, {
      wrapper: MemoryRouter,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load the book",
    );
  });

  it("offers a way back to the library", () => {
    render(<PageError message="Couldn't load the book" />, {
      wrapper: MemoryRouter,
    });

    expect(
      screen.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/");
  });
});

describe("PageNotFound", () => {
  it("names what wasn't found", () => {
    render(<PageNotFound subject="Book" />, { wrapper: MemoryRouter });

    expect(screen.getByText("Book not found.")).toBeInTheDocument();
  });
});

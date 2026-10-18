import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ADA, AppHarness } from "../../testing/AppHarness";
import { TopNav } from "./TopNav";

describe("TopNav", () => {
  it("shows the signed-in reader's name", () => {
    render(
      <AppHarness>
        <TopNav />
      </AppHarness>,
    );

    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("offers Add books to a reader who can upload", () => {
    render(
      <AppHarness>
        <TopNav />
      </AppHarness>,
    );

    expect(screen.getByRole("link", { name: "Add books" })).toBeInTheDocument();
  });

  it("hides Add books from a reader who can't upload", () => {
    render(
      <AppHarness user={{ ...ADA, canUpload: false }}>
        <TopNav />
      </AppHarness>,
    );

    expect(
      screen.queryByRole("link", { name: "Add books" }),
    ).not.toBeInTheDocument();
  });

  it("marks the section the page belongs to", () => {
    render(
      <AppHarness path="/authors/12">
        <TopNav />
      </AppHarness>,
    );

    expect(screen.getByRole("link", { name: "Authors" })).toHaveClass("on");
    expect(screen.getByRole("link", { name: "Library" })).not.toHaveClass("on");
  });
});

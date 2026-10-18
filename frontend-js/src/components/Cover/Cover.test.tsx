import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { aBook, COVER_ART } from "../../testing/books";
import { Cover } from "./Cover";

describe("Cover", () => {
  it("shows the cover image named for its book", () => {
    render(<Cover book={aBook()} src={COVER_ART} />);

    expect(
      screen.getByRole("img", { name: "Cover of Aurora Station, Vol. 1" }),
    ).toHaveAttribute("src", COVER_ART);
  });

  it("draws the typeset plate when there is no image", () => {
    render(<Cover book={aBook({ hasCover: false })} src={null} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("INKWELL")).toBeInTheDocument();
  });

  it("falls back to the plate when the image fails to load", () => {
    render(<Cover book={aBook()} src="/missing.png" />);

    fireEvent.error(screen.getByRole("img"));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Aurora Station, Vol. 1")).toBeInTheDocument();
  });
});

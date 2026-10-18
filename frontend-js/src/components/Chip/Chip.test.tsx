import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("renders as an item of its list", () => {
    render(
      <ul>
        <Chip>Space opera</Chip>
      </ul>,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent("Space opera");
  });

  it("draws a genre chip in the genre tone", () => {
    render(
      <ul>
        <Chip tone="genre">Science fiction</Chip>
      </ul>,
    );

    expect(screen.getByRole("listitem")).toHaveAttribute(
      "class",
      "chip chip-genre",
    );
  });
});

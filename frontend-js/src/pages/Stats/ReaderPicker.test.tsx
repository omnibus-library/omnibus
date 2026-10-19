import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { parseUserId, type UserId } from "../../api";
import { aWireReader } from "../../testing/statsHandlers";
import { ReaderPicker } from "./ReaderPicker";

const READERS = [aWireReader(), aWireReader({ id: 2, is_you: false })];

function renderPicker(selected: UserId | null) {
  render(
    <MemoryRouter>
      <ReaderPicker readers={READERS} selected={selected} />
    </MemoryRouter>,
  );
}

describe("ReaderPicker", () => {
  describe("menu", () => {
    it("marks the caller's entry current when no reader is selected", () => {
      renderPicker(null);

      expect(screen.getByTestId("stats-reader-option-you")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByTestId("stats-reader-option-2")).toHaveAttribute(
        "aria-current",
        "false",
      );
    });

    it("marks the caller's entry current when their own id is selected", () => {
      renderPicker(parseUserId("1"));

      expect(screen.getByTestId("stats-reader-option-you")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("marks another reader's entry current when their id is selected", () => {
      renderPicker(parseUserId("2"));

      expect(screen.getByTestId("stats-reader-option-2")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByTestId("stats-reader-option-you")).toHaveAttribute(
        "aria-current",
        "false",
      );
    });
  });
});

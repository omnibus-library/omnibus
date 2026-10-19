import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BarcodeScanner } from "./BarcodeScanner";

vi.mock("./loadScanner", () => ({
  loadScanner: () => Promise.reject(new Error("the glue failed to load")),
}));

describe("BarcodeScanner", () => {
  it("says the scanner could not start when its scripts fail to load", async () => {
    render(<BarcodeScanner onDetect={vi.fn()} onManual={vi.fn()} />);

    expect(
      await screen.findByText(
        "The scanner couldn't start. Type the ISBN instead.",
      ),
    ).toBeInTheDocument();
  });

  it("leads with the manual button when its scripts fail to load", async () => {
    render(<BarcodeScanner onDetect={vi.fn()} onManual={vi.fn()} />);

    await screen.findByText(/couldn't start/);

    expect(
      screen.getByRole("button", { name: "Enter ISBN instead" }),
    ).toHaveClass("primary");
  });
});

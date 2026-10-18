import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field";

const base = {
  id: "username",
  label: "Username",
  autoComplete: "username",
  value: "",
  onChange: () => {},
};

describe("Field", () => {
  it("reports what the reader types", async () => {
    const onChange = vi.fn();
    render(<Field {...base} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Username"), "a");

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("announces an error as an alert", () => {
    render(<Field {...base} error="Required." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Required.");
  });

  it("marks the input invalid while there is an error", () => {
    render(<Field {...base} error="Required." />);

    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows the check mark once the value is valid", () => {
    render(<Field {...base} value="ada" valid />);

    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("hides the hint behind an error", () => {
    render(<Field {...base} hint="Ends in @kindle.com" error="Required." />);

    expect(screen.queryByText("Ends in @kindle.com")).not.toBeInTheDocument();
  });
});

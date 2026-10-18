import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Banner } from "./Banner";

describe("Banner", () => {
  it.each([
    ["err", "alert"],
    ["warn", "status"],
    ["info", "status"],
    ["ok", "status"],
  ] as const)("announces a %s banner as %s", (kind, role) => {
    render(<Banner kind={kind} title="Heads up" />);

    expect(screen.getByRole(role)).toHaveTextContent("Heads up");
  });

  it("shows the message under the title", () => {
    render(<Banner kind="warn" title="Closed" message="Ask an admin." />);

    expect(screen.getByText("Ask an admin.")).toBeInTheDocument();
  });

  it("shows the action it is given", () => {
    render(
      <Banner kind="err" title="Offline">
        <button type="button">Retry</button>
      </Banner>,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

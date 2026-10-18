import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BusyLabel, CoverSkeletons, Loading, Stale } from "./Loading";

describe("Loading", () => {
  it("announces its label as a status", () => {
    render(<Loading label="Taking it off the shelf" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Taking it off the shelf",
    );
  });

  it.each([
    ["page", "ld-riffle"],
    ["stage", "ld-riffle"],
    ["sheet", "ld-line"],
    ["section", "ld-line"],
    ["row", "ld-ring"],
  ] as const)("marks a %s wait with %s", (kind, mark) => {
    render(<Loading kind={kind} />);

    expect(screen.getByRole("status").querySelector(`.${mark}`)).not.toBeNull();
  });

  it("shows a retry in its slot", () => {
    render(
      <Loading kind="stage">
        <button type="button">Try again</button>
      </Loading>,
    );

    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("BusyLabel", () => {
  it("shows the busy label while busy", () => {
    render(<BusyLabel busy label="Save" busyLabel="Saving…" />);

    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("shows the idle label otherwise", () => {
    render(<BusyLabel busy={false} label="Save" busyLabel="Saving…" />);

    expect(screen.getByText("Save")).toBeInTheDocument();
  });
});

describe("CoverSkeletons", () => {
  it("draws one cell per placeholder", () => {
    const { container } = render(<CoverSkeletons count={5} />);

    expect(container.querySelectorAll(".ld-covers-cell")).toHaveLength(5);
  });
});

describe("Stale", () => {
  it("flags its content busy while stale", () => {
    render(
      <Stale stale>
        <p>Rows</p>
      </Stale>,
    );

    expect(screen.getByText("Rows").parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});

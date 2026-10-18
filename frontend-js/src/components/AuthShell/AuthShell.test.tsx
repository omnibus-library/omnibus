import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthShell, Emphasis } from "./AuthShell";

describe("AuthShell", () => {
  it("heads the form column with its title", () => {
    render(
      <AuthShell
        kicker="Sign in"
        title={
          <>
            Welcome <Emphasis>back</Emphasis>
          </>
        }
        lede="Continue to your library."
      >
        <p>Form</p>
      </AuthShell>,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Welcome back",
    );
  });

  it("renders its content in the form column", () => {
    render(
      <AuthShell kicker="Sign in" title="Welcome" lede="Continue.">
        <p>Form</p>
      </AuthShell>,
    );

    expect(screen.getByText("Form")).toBeInTheDocument();
  });
});

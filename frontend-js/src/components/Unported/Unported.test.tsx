import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Unported } from "./Unported";

describe("Unported", () => {
  it("names the Dioxus source still to port", () => {
    render(
      <Unported title="Authors" source="frontend/src/pages/authors_index.rs" />,
    );

    expect(
      screen.getByText("frontend/src/pages/authors_index.rs"),
    ).toBeInTheDocument();
  });

  it("shows a dash for a parameter the route didn't get", () => {
    render(
      <Unported
        title="PDF reader"
        source="x"
        params={{ page: "7", file_id: null }}
      />,
    );

    expect(screen.getByText("file_id").nextElementSibling).toHaveTextContent(
      "—",
    );
  });

  it("titles the browser tab after the page", () => {
    render(<Unported title="Authors" source="x" />);

    expect(document.title).toBe("Omnibus | Authors");
  });
});

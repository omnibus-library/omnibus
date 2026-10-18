import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { User } from "./api";
import { routes } from "./router";
import { ADA, harnessClient } from "./testing/AppHarness";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

function renderRoute(path: string, user: User | null = ADA) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={harnessClient(user)}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("routes", () => {
  describe("unported pages", () => {
    it.each([
      [`/books/${UUID}/edit`, "Edit metadata", UUID],
      [`/read/${UUID}`, "Reader", UUID],
      [`/comic/${UUID}`, "Comic reader", UUID],
      [`/pdf/${UUID}?file_id=3&page=7`, "PDF reader", "7"],
      [`/listen/${UUID}?file_id=2`, "Listen", "2"],
      ["/authors", "Authors", null],
      ["/authors/12", "Author", "12"],
      ["/series", "Series", null],
      ["/series/4", "Series", "4"],
      ["/stats?user=2", "Stats", "2"],
      ["/stats/chart", "Chart builder", null],
      ["/shelves", "Shelves", null],
      ["/shelves/9", "Shelf", "9"],
      ["/search", "Search", null],
      ["/search/dune", "Search", "dune"],
      ["/settings?section=smtp", "Settings", "smtp"],
      ["/settings/cleanup/duplicates", "Cleanup review", "duplicates"],
      ["/admin/health", "Server health", null],
      ["/account", "Account", null],
      ["/add-books", "Add books", null],
      ["/check-in", "Check in", null],
    ])("renders %s as %s with its parameters", async (path, title, param) => {
      renderRoute(path);

      expect(
        await screen.findByRole("heading", { level: 1, name: title }),
      ).toBeInTheDocument();
      if (param) expect(screen.getByText(param)).toBeInTheDocument();
    });
  });

  describe("layout", () => {
    it("puts a page under the top bar", async () => {
      renderRoute("/authors");

      expect(
        await screen.findByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument();
    });

    it("gives a reader the whole screen", async () => {
      renderRoute(`/read/${UUID}`);

      await screen.findByRole("heading", { name: "Reader" });
      expect(
        screen.queryByRole("navigation", { name: "Primary" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("signed-out pages", () => {
    it.each([
      ["/login", "Welcome back"],
      ["/register", "Join the library"],
      ["/connect", "Find your server"],
    ])("renders %s without a session", async (path, title) => {
      renderRoute(path, null);

      expect(
        await screen.findByRole("heading", { level: 2, name: title }),
      ).toBeInTheDocument();
    });

    it("sends a guest to sign in with the page they asked for", async () => {
      const router = renderRoute("/shelves/9", null);

      await waitFor(() =>
        expect(router.state.location.pathname).toBe("/login"),
      );
      expect(router.state.location.search).toBe("?next=%2Fshelves%2F9");
    });
  });

  it("redirects /logs to the settings logs section", async () => {
    const router = renderRoute("/logs");

    await waitFor(() =>
      expect(router.state.location.search).toBe("?section=logs"),
    );
    expect(router.state.location.pathname).toBe("/settings");
  });

  it("renders not found for a path nothing lives at", async () => {
    renderRoute("/no/such/page");

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});

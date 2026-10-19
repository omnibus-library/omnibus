import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { User } from "./api";
import { routes } from "./router";
import { meQuery } from "./session";
import { ADA, harnessClient } from "./testing/AppHarness";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

function renderRoute(
  path: string,
  user: User | null = ADA,
  table: RouteObject[] = routes,
) {
  const router = createMemoryRouter(table, { initialEntries: [path] });
  render(
    <QueryClientProvider client={harnessClient(user)}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function Collapse(): never {
  throw new Error("The shelf collapsed.");
}

// A copy of `table` with `extra` added to the route list that holds `sibling`.
function withRoute(
  table: RouteObject[],
  sibling: string,
  extra: RouteObject,
): RouteObject[] {
  return table.map((route) => {
    if (route.index || !route.children) return route;
    if (route.children.some((child) => child.path === sibling)) {
      return { ...route, children: [extra, ...route.children] };
    }
    return { ...route, children: withRoute(route.children, sibling, extra) };
  });
}

describe("routes", () => {
  it("renders the library at /", async () => {
    renderRoute("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your Library" }),
    ).toBeInTheDocument();
  });

  it("keeps the app up when refreshing the session fails", async () => {
    const client = harnessClient();
    const failing = {
      ...meQuery,
      staleTime: 0,
      queryFn: () => Promise.reject(new Error("offline")),
    };
    await client.fetchQuery(failing).catch(() => {});
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your Library" }),
    ).toBeInTheDocument();
  });

  describe("unported pages", () => {
    it.each([
      [`/books/${UUID}/edit`, "Edit metadata", UUID],
      [`/read/${UUID}`, "Reader", UUID],
      [`/comic/${UUID}`, "Comic reader", UUID],
      [`/pdf/${UUID}?file_id=3&page=7`, "PDF reader", "7"],
      [`/listen/${UUID}?file_id=2`, "Listen", "2"],
      ["/stats?user=2", "Stats", "2"],
      ["/stats/chart", "Chart builder", null],
      ["/settings?section=smtp", "Settings", "smtp"],
      ["/settings/cleanup/duplicates", "Cleanup review", "duplicates"],
      ["/admin?section=logs", "Administration", "logs"],
      ["/admin/cleanup/duplicates", "Cleanup review", "duplicates"],
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

  describe("ported pages", () => {
    it.each([
      ["/series", "Gathering every series"],
      ["/series/4", "Gathering the series"],
      ["/shelves", "Gathering your shelves"],
      ["/shelves/9", "Opening the shelf"],
    ])("renders %s as its loading page, not a stub", async (path, label) => {
      renderRoute(path);

      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
    });

    it.each([["/authors"], ["/authors/12"]])(
      "renders %s as the authors browser, not a stub",
      async (path) => {
        renderRoute(path);

        expect(
          await screen.findByRole("heading", { level: 1, name: "Authors" }),
        ).toBeInTheDocument();
        expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
      },
    );
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

  describe("search palette", () => {
    it("makes the page behind the open palette inert", async () => {
      renderRoute("/authors");
      const nav = await screen.findByRole("navigation", { name: "Primary" });

      await userEvent.keyboard("{Control>}k{/Control}");

      expect(nav.closest(".app-shell")).toHaveAttribute("inert");
    });
  });

  describe("signed-out pages", () => {
    it.each([
      ["/login", "Welcome back"],
      ["/register", "Make yourself at home"],
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

  describe("error pages", () => {
    it("keeps the top bar when a page throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const table = withRoute(routes, "*", {
        path: "/boom",
        element: <Collapse />,
      });

      renderRoute("/boom", ADA, table);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The shelf collapsed.",
      );
      expect(
        screen.getByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it("shows a full-screen route's error without the top bar", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const table = withRoute(routes, "/read/:uuid", {
        path: "/boom",
        element: <Collapse />,
      });

      renderRoute("/boom", ADA, table);

      expect(
        await screen.findByRole("heading", { name: "Something went wrong" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("navigation", { name: "Primary" }),
      ).not.toBeInTheDocument();
      vi.restoreAllMocks();
    });
  });

  it("redirects /logs to the settings logs section", async () => {
    const router = renderRoute("/logs");

    await waitFor(() =>
      expect(router.state.location.search).toBe("?section=logs"),
    );
    expect(router.state.location.pathname).toBe("/settings");
  });

  it("redirects /connect to the library", async () => {
    const router = renderRoute("/connect");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("redirects a bare /search to the library", async () => {
    const router = renderRoute("/search");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("renders not found for a path nothing lives at", async () => {
    renderRoute("/no/such/page");

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});

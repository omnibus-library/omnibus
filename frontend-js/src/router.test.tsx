import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { User } from "./api";
import { AtriumRoot } from "./components/Theme/AtriumRoot";
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
      <AtriumRoot>
        <RouterProvider router={router} />
      </AtriumRoot>
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
      [`/listen/${UUID}?file_id=2`, "Listen", "2"],
      ["/authors", "Authors", null],
      ["/authors/12", "Author", "12"],
      ["/series", "Series", null],
      ["/series/4", "Series", "4"],
      ["/stats?user=2", "Stats", "2"],
      ["/stats/chart", "Chart builder", null],
      ["/shelves", "Shelves", null],
      ["/shelves/9", "Shelf", "9"],
      ["/settings?section=smtp", "Settings", "smtp"],
      ["/settings/cleanup/duplicates", "Cleanup review", "duplicates"],
      ["/admin?section=logs", "Administration", "logs"],
      ["/admin/cleanup/duplicates", "Cleanup review", "duplicates"],
      ["/admin/health", "Server health", null],
      ["/account", "Account", null],
    ])("renders %s as %s with its parameters", async (path, title, param) => {
      renderRoute(path);

      expect(
        await screen.findByRole("heading", { level: 1, name: title }),
      ).toBeInTheDocument();
      if (param) expect(screen.getByText(param)).toBeInTheDocument();
    });
  });

  it("renders the metadata editor at /books/:uuid/edit", async () => {
    renderRoute(`/books/${UUID}/edit`);

    // jsdom has no server to fetch from, so the editor settles on its error page.
    expect(
      await screen.findByRole("link", { name: "Back to book" }),
    ).toHaveAttribute("href", `/books/${UUID}`);
  });

  it("renders the upload page at /add-books", async () => {
    renderRoute("/add-books");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Upload a book" }),
    ).toBeInTheDocument();
  });

  it("renders the check-in flow at /check-in", async () => {
    renderRoute("/check-in");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Check in a book" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["the EPUB reader", `/read/${UUID}`, "Back to book"],
    ["the comic reader", `/comic/${UUID}`, "Back"],
    ["the PDF reader", `/pdf/${UUID}?file_id=3&page=7`, "Back"],
  ])("gives %s the whole screen", async (_name, path, back) => {
    renderRoute(path);

    expect(await screen.findByRole("button", { name: back })).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Primary" }),
    ).not.toBeInTheDocument();
  });

  describe("reader Back", () => {
    // A browser router, for the history index Back reads; jsdom's history is shared, so each test seeds its own.
    const openBrowserRouter = (path: string) => {
      window.history.replaceState(null, "", path);
      const router = createBrowserRouter(routes);
      render(
        <QueryClientProvider client={harnessClient(ADA)}>
          <AtriumRoot>
            <RouterProvider router={router} />
          </AtriumRoot>
        </QueryClientProvider>,
      );
      return router;
    };

    it("returns to the book when the reader replaced the page the app opened on", async () => {
      const router = openBrowserRouter(`/login?next=/comic/${UUID}`);
      await router.navigate(`/comic/${UUID}`, { replace: true });

      await userEvent.click(
        await screen.findByRole("button", { name: "Back" }),
      );

      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/books/${UUID}`),
      );
    });

    it("goes back in history when the reader was opened from inside the app", async () => {
      const router = openBrowserRouter("/authors");
      await router.navigate(`/comic/${UUID}`);

      await userEvent.click(
        await screen.findByRole("button", { name: "Back" }),
      );

      await waitFor(() =>
        expect(router.state.location.pathname).toBe("/authors"),
      );
    });
  });

  describe("layout", () => {
    it("puts a page under the top bar", async () => {
      renderRoute("/authors");

      expect(
        await screen.findByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument();
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

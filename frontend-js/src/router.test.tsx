import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import {
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { toUser, type User } from "./api";
import { AtriumRoot } from "./components/Theme/AtriumRoot";
import { routes } from "./router";
import { meQuery } from "./session";
import { ADA, harnessClient } from "./testing/AppHarness";
import { listenHandlers } from "./testing/audioHandlers";
import { aWireBook, WIRE_ADA } from "./testing/wire";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

function renderRouter(
  router: ReturnType<typeof createBrowserRouter>,
  user: User | null,
) {
  const client = harnessClient(user);
  render(
    <QueryClientProvider client={client}>
      <AtriumRoot>
        <RouterProvider router={router} />
      </AtriumRoot>
    </QueryClientProvider>,
  );
  return { router, client };
}

function renderRoute(
  path: string,
  user: User | null = ADA,
  table: RouteObject[] = routes,
) {
  return renderRouter(
    createMemoryRouter(table, { initialEntries: [path] }),
    user,
  );
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

  describe("ported pages", () => {
    it("renders /settings as the settings page, not a stub", async () => {
      renderRoute("/settings");

      expect(
        await screen.findByRole("heading", { level: 1, name: "Settings" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
    });

    it.each([
      ["/shelves", "Gathering your shelves"],
      ["/shelves/9", "Opening the shelf"],
      ["/stats?user=2", "Tallying your reading"],
    ])("renders %s as its loading page, not a stub", async (path, label) => {
      renderRoute(path);

      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
    });

    it("renders /stats/chart as the chart builder, not a stub", async () => {
      renderRoute("/stats/chart");

      expect(
        await screen.findByText(
          "Nothing plotted yet — tick a measure above and it'll appear here.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
    });

    it.each([["/series"], ["/series/4"]])(
      "renders %s as the series browser, not a stub",
      async (path) => {
        renderRoute(path);

        expect(
          await screen.findByRole("heading", { level: 1, name: "Series" }),
        ).toBeInTheDocument();
        expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
      },
    );

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

    it("renders the book page under /books/:uuid/edit", async () => {
      renderRoute(`/books/${UUID}/edit`);

      // jsdom has no server to fetch from, so the page settles on its load error: the book page owns the route.
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't load the book",
      );
      expect(
        screen.getByRole("link", { name: "Back to library" }),
      ).toHaveAttribute("href", "/");
    });

    it("renders the player page at /listen/:uuid", async () => {
      renderRoute(`/listen/${UUID}?file_id=2`);

      // jsdom has no server to fetch from, so the player settles on its error page.
      expect(
        await screen.findByRole("link", { name: "Back to library" }),
      ).toHaveAttribute("href", "/");
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
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
        await screen.findByRole("heading", {
          level: 1,
          name: "Check in a book",
        }),
      ).toBeInTheDocument();
    });

    it("draws the library behind the check-in dialog", async () => {
      renderRoute("/check-in");

      await screen.findByRole("dialog", { name: "Check in a book" });
      expect(
        await screen.findByRole("heading", { level: 1, name: "Your Library" }),
      ).toBeInTheDocument();
    });

    it("keeps the library mounted beneath the check-in dialog", async () => {
      const { router } = renderRoute("/");
      const heading = await screen.findByRole("heading", {
        level: 1,
        name: "Your Library",
      });

      await act(() => router.navigate("/check-in"));

      await screen.findByRole("dialog", { name: "Check in a book" });
      expect(
        screen.getByRole("heading", { level: 1, name: "Your Library" }),
      ).toBe(heading);
    });

    it("closes the check-in dialog back to the page it opened from", async () => {
      const { router } = renderRoute("/");
      await screen.findByRole("heading", { level: 1, name: "Your Library" });
      await act(() => router.navigate("/check-in"));
      await screen.findByRole("dialog", { name: "Check in a book" });

      await userEvent.keyboard("{Escape}");

      await waitFor(() => expect(router.state.historyAction).toBe("POP"));
      expect(router.state.location.pathname).toBe("/");
    });

    it("closes the check-in dialog onto the library on Escape", async () => {
      const { router } = renderRoute("/check-in");
      await screen.findByRole("dialog", { name: "Check in a book" });

      await userEvent.keyboard("{Escape}");

      await waitFor(() => expect(router.state.location.pathname).toBe("/"));
      expect(
        screen.queryByRole("dialog", { name: "Check in a book" }),
      ).not.toBeInTheDocument();
    });

    it("renders the cleanup review at /admin/cleanup/tag, not a stub", async () => {
      renderRoute("/admin/cleanup/tag");

      expect(
        await screen.findByRole("heading", { level: 1, name: "Review tags" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
    });

    it("renders an unknown cleanup kind as a notice, not a stub", async () => {
      renderRoute("/admin/cleanup/duplicates");

      expect(
        await screen.findByText("Unknown cleanup kind."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
    });

    it("renders the administration shell at /admin?section=people, not a stub", async () => {
      renderRoute("/admin?section=people");

      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Administration",
        }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("heading", { level: 2, name: "People" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Not ported yet")).not.toBeInTheDocument();
    });
  });

  describe("administration", () => {
    const READER: User = { ...ADA, isAdmin: false };

    it.each(["/admin", "/logs", "/admin/health"])(
      "refuses a reader at %s without the admin sidebar",
      async (path) => {
        renderRoute(path, READER);

        expect(await screen.findByTestId("admin-forbidden")).toHaveTextContent(
          "Administration is only open to server administrators.",
        );
        expect(
          screen.getByRole("heading", { level: 1, name: "Administration" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("navigation", { name: "Administration sections" }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("admin-nav-people"),
        ).not.toBeInTheDocument();
      },
    );

    it("refuses a reader at /admin/cleanup/tag without the admin chrome", async () => {
      renderRoute("/admin/cleanup/tag", READER);

      expect(
        await screen.findByTestId("cleanup-review-forbidden"),
      ).toHaveTextContent(
        "Administrator access is required to review library cleanup.",
      );
      expect(
        screen.getByRole("heading", { level: 1, name: "Review tags" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("navigation", { name: "breadcrumb" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("cleanup-kindline")).not.toBeInTheDocument();
    });

    it("waits on the session loader, not the shell, while the session is pending", async () => {
      const client = new QueryClient();
      void client.fetchQuery({
        ...meQuery,
        queryFn: () => new Promise<never>(() => {}),
      });
      render(
        <QueryClientProvider client={client}>
          <RouterProvider
            router={createMemoryRouter(routes, {
              initialEntries: ["/admin"],
            })}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText("Opening your library")).toBeVisible();
      expect(screen.queryByTestId("admin-layout")).not.toBeInTheDocument();
    });

    it.each([
      ["/logs", "/admin", "?section=logs"],
      ["/admin/health", "/admin", "?section=health"],
      ["/settings/cleanup/tag", "/admin/cleanup/tag", ""],
    ])(
      "sends %s to %s%s in place of the old entry",
      async (from, pathname, search) => {
        const { router } = renderRoute(from);

        await waitFor(() =>
          expect(router.state.location.pathname).toBe(pathname),
        );
        expect(router.state.location.search).toBe(search);
        expect(router.state.historyAction).toBe("REPLACE");
      },
    );
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

  describe("reader back", () => {
    // A browser router, for the history index Back reads; jsdom's history is shared, so each test seeds its own and the next starts clean.
    let router: ReturnType<typeof createBrowserRouter> | undefined;
    const openBrowserRouter = (path: string) => {
      window.history.replaceState(null, "", path);
      router = renderRouter(createBrowserRouter(routes), ADA).router;
      return router;
    };
    afterEach(() => {
      router?.dispose();
      window.history.replaceState(null, "", "/");
    });

    it("returns to the book when the reader replaced the page the app opened on", async () => {
      const opened = openBrowserRouter(`/login?next=/comic/${UUID}`);
      await opened.navigate(`/comic/${UUID}`, { replace: true });

      await userEvent.click(
        await screen.findByRole("button", { name: "Back" }),
      );

      await waitFor(() =>
        expect(opened.state.location.pathname).toBe(`/books/${UUID}`),
      );
    });

    it("goes back in history when the reader was opened from inside the app", async () => {
      const opened = openBrowserRouter("/authors");
      await opened.navigate(`/comic/${UUID}`);

      await userEvent.click(
        await screen.findByRole("button", { name: "Back" }),
      );

      await waitFor(() =>
        expect(opened.state.location.pathname).toBe("/authors"),
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

    it("gives a reader the whole screen", async () => {
      renderRoute(`/read/${UUID}`);

      await screen.findByTestId("reader-top");
      expect(
        screen.queryByRole("navigation", { name: "Primary" }),
      ).not.toBeInTheDocument();
    });

    it("leaves an empty dock host after a page", async () => {
      renderRoute("/");
      await screen.findByRole("heading", { level: 1, name: "Your Library" });

      expect(
        document.querySelector(".app-shell > main + .mini-dock-host"),
      ).toBeEmptyDOMElement();
    });

    it("docks the audiobook beneath a reader, giving the stage room only while it shows", async () => {
      renderRoute(`/read/${UUID}`);
      await screen.findByTestId("reader-top");

      const host = document.querySelector(".rd-host.rd-dock-full");
      expect(host).not.toHaveClass("rd-immersive");
      expect(
        host?.querySelector(":scope > .mini-dock-host"),
      ).toBeEmptyDOMElement();
    });

    describe("with an audiobook loaded", () => {
      const server = setupServer(
        ...listenHandlers(aWireBook({ formats: ["M4B"] })),
      );
      beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
      afterAll(() => server.close());

      it("gives a reader's stage room above the dock", async () => {
        const { router } = renderRoute(`/listen/${UUID}`);
        await screen.findByText("Now playing · Chapter 1 of 3");

        act(() => {
          void router.navigate(`/read/${UUID}`);
        });

        await screen.findByRole("region", { name: "Now playing" });
        expect(document.querySelector(".rd-host.rd-dock-full")).toHaveClass(
          "rd-immersive",
        );
      });
    });

    it("keeps the dock off the player", async () => {
      renderRoute(`/listen/${UUID}`);
      await screen.findByRole("link", { name: "Back to library" });

      expect(document.querySelector(".mini-dock-host")).toBeNull();
    });
  });

  describe("audio", () => {
    it("stops the element when the session ends", async () => {
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
      const { client } = renderRoute("/");
      await screen.findByRole("heading", { level: 1, name: "Your Library" });
      pause.mockClear();

      act(() => client.setQueryData(meQuery.queryKey, null));

      await waitFor(() => expect(pause).toHaveBeenCalled());
      vi.restoreAllMocks();
    });

    it("starts a fresh player when another user takes the session", async () => {
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
      const { client } = renderRoute("/");
      await screen.findByRole("heading", { level: 1, name: "Your Library" });
      pause.mockClear();

      act(() =>
        client.setQueryData(
          meQuery.queryKey,
          toUser({ ...WIRE_ADA, id: WIRE_ADA.id + 1 }),
        ),
      );

      await waitFor(() => expect(pause).toHaveBeenCalled());
      vi.restoreAllMocks();
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
      const { router } = renderRoute("/shelves/9", null);

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

  it("redirects /account to settings", async () => {
    const { router } = renderRoute("/account");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/settings"),
    );
    expect(router.state.historyAction).toBe("REPLACE");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("sends an old settings section to its new one", async () => {
    const { router } = renderRoute("/settings?section=kobo");

    await waitFor(() =>
      expect(router.state.location.search).toBe("?section=devices"),
    );
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("redirects /connect to the library", async () => {
    const { router } = renderRoute("/connect");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("redirects a bare /search to the library", async () => {
    const { router } = renderRoute("/search");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("renders not found for a path nothing lives at", async () => {
    renderRoute("/no/such/page");

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});

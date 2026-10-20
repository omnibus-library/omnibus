import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { meQuery } from "../../session";
import { ADA } from "../../testing/AppHarness";
import { reconnect, returnToTab } from "../../testing/focus";
import { aWireReader, statsHandlers } from "../../testing/statsHandlers";
import { aWireResumePoint } from "../../testing/wire";
import { Stats } from "./Stats";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const READERS = [
  aWireReader(),
  aWireReader({ id: 2, name: "Grace", is_you: false }),
];

/** The page under the client `main.tsx` builds (no retries, the default staleTime of zero), signed in as `RequireAuth` leaves it. */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(meQuery.queryKey, ADA);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/stats"]}>
        <Stats />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("Stats", () => {
  describe("returning to the tab", () => {
    it("keeps the page when the stats refetch fails", async () => {
      server.use(...statsHandlers({ readers: READERS }));
      const client = renderPage();
      await screen.findByTestId("stats-scope-user");

      server.use(...statsHandlers({ stats: () => 500 }));
      await returnToTab(client);

      expect(screen.getByTestId("stats-scope-user")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("keeps the household's readers when their refetch fails", async () => {
      server.use(...statsHandlers({ readers: READERS }));
      const client = renderPage();
      await screen.findByTestId("stats-reader-picker");

      server.use(...statsHandlers({ readers: 500 }));
      await returnToTab(client);

      expect(screen.getByTestId("stats-reader-picker")).toBeInTheDocument();
    });

    it("keeps the open books when their refetch fails", async () => {
      server.use(
        ...statsHandlers({
          readers: READERS,
          recent: [aWireResumePoint({}, { title: "Open Book 1" })],
        }),
      );
      const client = renderPage();
      await screen.findByText("Open Book 1");

      server.use(...statsHandlers({ recent: 500 }));
      await returnToTab(client);

      expect(screen.getByText("Open Book 1")).toBeInTheDocument();
      expect(screen.queryByText("Nothing open right now.")).toBeNull();
    });

    it("keeps the library's size and make-up when their refetch fails", async () => {
      server.use(...statsHandlers({ readers: READERS }));
      const client = renderPage();
      await userEvent.click(
        await screen.findByTestId("stats-scope-tab-library"),
      );
      await screen.findByTestId("stats-library-size");
      await screen.findByTestId("stats-library-composition");

      server.use(...statsHandlers({ size: 500, composition: 500 }));
      await returnToTab(client);

      expect(screen.getByTestId("stats-library-size")).toBeInTheDocument();
      expect(
        screen.getByTestId("stats-library-composition"),
      ).toBeInTheDocument();
    });
  });

  describe("reconnecting", () => {
    it("keeps the page when the stats refetch fails", async () => {
      server.use(...statsHandlers({ readers: READERS }));
      const client = renderPage();
      await screen.findByTestId("stats-scope-user");

      server.use(...statsHandlers({ stats: () => 500 }));
      await reconnect(client);

      expect(screen.getByTestId("stats-scope-user")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});

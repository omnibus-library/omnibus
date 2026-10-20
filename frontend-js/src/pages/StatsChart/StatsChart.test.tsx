import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { returnToTab } from "../../testing/focus";
import { statsHandlers } from "../../testing/statsHandlers";
import { StatsChart } from "./StatsChart";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("StatsChart", () => {
  describe("returning to the tab", () => {
    it("keeps the chart when its refetch fails", async () => {
      server.use(...statsHandlers());
      // The client `main.tsx` builds: no retries, and the default staleTime of zero.
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <StatsChart />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await userEvent.click(
        screen.getByRole("checkbox", { name: "Books finished" }),
      );
      await screen.findByTestId("chart-canvas");

      server.use(...statsHandlers({ chart: () => 500 }));
      await returnToTab(client);

      expect(screen.getByTestId("chart-canvas")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});

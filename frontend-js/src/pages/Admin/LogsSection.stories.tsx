import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { logsQuery } from "../../api";
import { storyClient } from "../../testing/AppHarness";
import {
  aWireLogPage,
  aWireLogRecord,
  type LogRequest,
  logsHandler,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { LogsSection } from "./LogsSection";

const LOGS = "/api/admin/logs";

let received: LogRequest[] = [];

const FIRST_PAGE = aWireLogPage({
  has_more: true,
  records: [aWireLogRecord({ message: "first page line" })],
});
const SECOND_PAGE = aWireLogPage({
  page: 1,
  records: [aWireLogRecord({ message: "second page line" })],
});

/** Page 0 has an older page behind it; page 1 is the last. */
const twoPages = (request: LogRequest) =>
  request.page === "1" ? SECOND_PAGE : FIRST_PAGE;

const meta = {
  title: "Pages/Admin/LogsSection",
  component: LogsSection,
  beforeEach({ msw }) {
    received = [];
    msw.use(logsHandler(() => aWireLogPage(), { received }));
  },
} satisfies Meta<typeof LogsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(LOGS));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Server logs" }),
    ).toBeInTheDocument();
    const loading = await canvas.findByTestId("logs-loading");
    await expect(loading).toHaveAttribute("role", "status");
    await expect(loading).toHaveTextContent("Reading the logs");
    await expect(loading.querySelectorAll(".ld-rows-row")).toHaveLength(6);
    await expect(canvas.queryByTestId("logs-table")).not.toBeInTheDocument();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", LOGS, 500));
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByText("Couldn’t load the logs.");
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("logs-table")).not.toBeInTheDocument();
  },
};

export const TryAgainReadsTheLogsAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(LOGS, () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireLogPage()),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await expect(await canvas.findByTestId("logs-table")).toBeInTheDocument();
    await expect(
      canvas.queryByText("Couldn’t load the logs."),
    ).not.toBeInTheDocument();
  },
};

export const ShowsAnEmptyLine: Story = {
  beforeEach({ msw }) {
    msw.use(logsHandler(() => aWireLogPage({ records: [] })));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("logs-empty")).toHaveTextContent(
      "No log records match these filters.",
    );
    await expect(canvas.queryByTestId("logs-table")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("logs-prev")).not.toBeInTheDocument();
  },
};

export const ShowsTheLogStream: Story = {
  beforeEach({ msw }) {
    msw.use(
      logsHandler(() =>
        aWireLogPage({
          records: [
            aWireLogRecord({
              level: "ERROR",
              target: "omnibus::mail",
              message: "relay refused",
              fields: '{"path":"/api/smtp/test"}',
            }),
            aWireLogRecord({ level: "WARN" }),
            aWireLogRecord({ level: "INFO" }),
            aWireLogRecord({ level: "DEBUG" }),
            aWireLogRecord({ level: "TRACE" }),
            aWireLogRecord({ level: "NOTICE" }),
          ],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const stream = await canvas.findByRole("region", {
      name: "Server log stream",
    });
    const rows = within(stream).getAllByTestId("logs-row");
    await expect(rows[0]).toHaveTextContent(
      '2026-07-19T10:30:12.345678Z ERROR omnibus::mail relay refused {"path":"/api/smtp/test"}',
    );
    await expect(rows[1]).toHaveTextContent(
      "2026-07-19T10:30:12.345678Z WARN omnibus::backend request handled",
    );
    await expect(
      rows.map((row) => row.querySelector(".logs-level")?.className),
    ).toEqual([
      "logs-level logs-level-error",
      "logs-level logs-level-warn",
      "logs-level logs-level-info",
      "logs-level logs-level-debug",
      "logs-level logs-level-trace",
      "logs-level",
    ]);
  },
};

export const ApplySendsTheFiltersAtPageOne: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("logs-table");
    await userEvent.selectOptions(canvas.getByLabelText("Level"), "ERROR");
    await userEvent.type(canvas.getByLabelText("Module"), "  omnibus::mail ");
    await userEvent.type(canvas.getByLabelText("From"), "2026-07-19T10:30");
    await userEvent.type(canvas.getByLabelText("To"), "2026-07-19T11:45");
    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(received).toHaveLength(2));
    // Only the first read and the Apply went out: typing fetched nothing.
    await expect(received[0]).toEqual({ page: "0" });
    const { from, to, ...rest } = received[1] ?? {};
    await expect(rest).toEqual({
      level: "ERROR",
      module: "omnibus::mail",
      page: "0",
    });
    // The window is sent as the same instants in UTC, whatever zone the admin is in.
    await expect(Date.parse(`${from}:00Z`)).toBe(
      Date.parse("2026-07-19T10:30"),
    );
    await expect(Date.parse(`${to}:00Z`)).toBe(Date.parse("2026-07-19T11:45"));
  },
};

export const ApplyReadsTheLogsAgainWhenNothingChanged: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("logs-table");

    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(received).toHaveLength(2));
    await expect(received[1]).toEqual({ page: "0" });
  },
};

export const ApplyLeavesBlankFiltersOut: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("logs-table");
    await userEvent.type(canvas.getByLabelText("Module"), "   ");
    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(received).toHaveLength(2));
    await expect(received[1]).toEqual({ page: "0" });
  },
};

export const ShowsPageOneWithNewerDisabled: Story = {
  beforeEach({ msw }) {
    msw.use(logsHandler(twoPages));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("logs-table");
    await expect(canvas.getByTestId("logs-page-indicator")).toHaveTextContent(
      "Page 1",
    );
    await expect(canvas.getByRole("button", { name: "Newer" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Older" })).toBeEnabled();
  },
};

let secondPageGate = deferred();

export const OlderShowsLoadingWhileItsPageComesIn: Story = {
  beforeEach({ msw }) {
    secondPageGate = deferred();
    msw.use(
      logsHandler(async (request) => {
        if (request.page === "1") await secondPageGate.promise;
        return twoPages(request);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("first page line");
    await userEvent.click(canvas.getByRole("button", { name: "Older" }));

    const busy = await canvas.findByRole("button", { name: "Loading…" });
    await expect(busy).toHaveAttribute("data-testid", "logs-next");
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(busy).toBeDisabled();
    const newer = canvas.getByRole("button", { name: "Newer" });
    await expect(newer).toBeDisabled();
    await expect(newer).toHaveAttribute("aria-busy", "false");
    await expect(canvas.getByTestId("logs-page-indicator")).toHaveTextContent(
      "Page 2",
    );
    await expect(canvas.getByText("first page line")).toBeInTheDocument();

    secondPageGate.release();
    await canvas.findByText("second page line");
    await expect(canvas.queryByText("first page line")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Loading…" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Older" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Newer" })).toBeEnabled();
  },
};

let firstPageGate = deferred();

export const NewerShowsLoadingWhileItsPageComesIn: Story = {
  beforeEach({ msw }) {
    firstPageGate = deferred();
    let firstPageReads = 0;
    msw.use(
      logsHandler(async (request) => {
        // The second read of page one is the one Newer asks for.
        if (request.page === "0" && ++firstPageReads === 2) {
          await firstPageGate.promise;
        }
        return twoPages(request);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("first page line");
    await userEvent.click(canvas.getByRole("button", { name: "Older" }));
    await canvas.findByText("second page line");
    // Page one is cached; marking it stale makes Newer read it again.
    await storyClient().invalidateQueries({ queryKey: ["admin", "logs"] });
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Newer" })).toBeEnabled(),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Newer" }));

    const busy = await canvas.findByRole("button", { name: "Loading…" });
    await expect(busy).toHaveAttribute("data-testid", "logs-prev");
    await expect(canvas.getByRole("button", { name: "Older" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(canvas.getByTestId("logs-page-indicator")).toHaveTextContent(
      "Page 1",
    );
    firstPageGate.release();
    await canvas.findByText("first page line");
  },
};

export const ApplyGoesBackToPageOne: Story = {
  beforeEach({ msw }) {
    msw.use(logsHandler(twoPages, { received }));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("first page line");
    await userEvent.click(canvas.getByRole("button", { name: "Older" }));
    await canvas.findByText("second page line");

    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));

    await canvas.findByText("first page line");
    await expect(received.at(-1)).toEqual({ page: "0" });
    await expect(canvas.getByTestId("logs-page-indicator")).toHaveTextContent(
      "Page 1",
    );
  },
};

let staleGate = deferred();

export const AnOlderAnswerNeverReplacesANewerOne: Story = {
  beforeEach({ msw }) {
    staleGate = deferred();
    msw.use(
      logsHandler(async (request) => {
        if (request.page === "1") await staleGate.promise;
        return request.level === "ERROR"
          ? aWireLogPage({
              records: [aWireLogRecord({ message: "errors only" })],
            })
          : twoPages(request);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("first page line");
    await userEvent.click(canvas.getByRole("button", { name: "Older" }));
    await userEvent.selectOptions(canvas.getByLabelText("Level"), "ERROR");
    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));
    await canvas.findByText("errors only");

    staleGate.release();
    // The held page's answer has landed once its own query holds it.
    await waitFor(() =>
      expect(
        storyClient().getQueryState(
          logsQuery({
            level: null,
            module: null,
            from: null,
            to: null,
            page: 1,
          }).queryKey,
        )?.status,
      ).toBe("success"),
    );
    await expect(canvas.getByText("errors only")).toBeInTheDocument();
    await expect(
      canvas.queryByText("second page line"),
    ).not.toBeInTheDocument();
  },
};

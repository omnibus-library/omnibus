import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, within } from "storybook/test";
import {
  aWireBackgroundTask,
  aWireTaskProgress,
  aWireWorkerStatus,
  backgroundTasksHandler,
  JOB_ROUTES,
  maintenanceJobHandlers,
  workerStatusHandler,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { MaintenanceCard } from "./MaintenanceCard";
import { RecentTasksCard } from "./RecentTasksCard";

const queued: string[] = [];

const meta = {
  title: "Pages/Admin/Maintenance",
  component: MaintenanceCard,
  beforeEach({ msw }) {
    queued.length = 0;
    msw.use(
      workerStatusHandler(aWireWorkerStatus),
      ...maintenanceJobHandlers(queued),
      backgroundTasksHandler(() => [aWireBackgroundTask()]),
    );
  },
} satisfies Meta<typeof MaintenanceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const JOBS = [
  {
    name: "Scan library",
    description:
      "Look through both library folders now for new, changed and removed books, instead of waiting for the next automatic rescan.",
    queuedLine: "Library scan queued.",
    route: JOB_ROUTES.scan,
  },
  {
    name: "Refetch author pictures",
    description:
      "Look up every author’s photo on Open Library again. Pictures set by hand are kept.",
    queuedLine: "Author photo refetch queued.",
    route: JOB_ROUTES.photos,
  },
  {
    name: "Extract audiobook chapters",
    description:
      "Read chapter markers from audiobooks added before chapters were recorded.",
    queuedLine: "Chapter extraction queued.",
    route: JOB_ROUTES.chapters,
  },
  {
    name: "Bake overrides into EPUBs",
    description:
      "Rebuild the downloadable copy of every edited EPUB so downloads and Kobo sync carry your metadata and covers.",
    queuedLine: "EPUB override bake queued.",
    route: JOB_ROUTES.bake,
  },
];

export const ListsTheFourJobs: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Run a job" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Each job runs once on the server’s background worker; progress shows here.",
      ),
    ).toBeInTheDocument();
    for (const { name, description } of JOBS) {
      await expect(
        canvas.getByRole("button", { name }),
      ).toHaveAccessibleDescription(description);
    }
    // The line is in the page before it has anything to say.
    await expect(
      canvas.getByTestId("maintenance-status"),
    ).toBeEmptyDOMElement();
  },
};

export const QueuesEachJob: Story = {
  play: async ({ canvas, userEvent }) => {
    for (const { name, queuedLine } of JOBS) {
      await userEvent.click(await canvas.findByRole("button", { name }));
      const status = await canvas.findByText(queuedLine);
      await expect(status).toHaveClass("settings-status", "success");
    }

    await expect(queued).toEqual(JOBS.map((job) => job.route));
  },
};

let scanGate = deferred();

export const HoldsOnlyItsOwnButtonWhileQueuing: Story = {
  beforeEach({ msw }) {
    scanGate = deferred();
    msw.use(
      http.post(JOB_ROUTES.scan, async () => {
        await scanGate.promise;
        return new HttpResponse(null, { status: 200 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Scan library" }),
    );

    const busy = await canvas.findByRole("button", { name: "Queuing…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    for (const { name } of JOBS.slice(1)) {
      await expect(canvas.getByRole("button", { name })).toBeEnabled();
    }
    scanGate.release();
    await expect(await canvas.findByText("Library scan queued.")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Scan library" }),
    ).toBeEnabled();
  },
};

export const ShowsTheServersSentenceWhenAJobIsRefused: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        JOB_ROUTES.chapters,
        () =>
          new HttpResponse("no audiobook library configured", { status: 409 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Extract audiobook chapters" }),
    );

    const status = await canvas.findByText(
      "Failed to start chapter extraction: no audiobook library configured",
    );
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByRole("button", { name: "Extract audiobook chapters" }),
    ).toBeEnabled();
  },
};

export const ShowsWorkRunningOnTheServer: Story = {
  beforeEach({ msw }) {
    msw.use(
      workerStatusHandler(() =>
        aWireWorkerStatus({ active: [aWireTaskProgress()] }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("maintenance-card");
    await expect(
      await within(card).findByText("Scanning library"),
    ).toBeInTheDocument();
  },
};

export const RecentTasksLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/admin/background-tasks"));
  },
  render: () => <RecentTasksCard />,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Recent tasks" }),
    ).toBeInTheDocument();
    const loading = canvas.getByTestId("background-tasks-loading");
    await expect(loading).toHaveAttribute("role", "status");
    await expect(loading).toHaveTextContent("Reading the task history");
    await expect(loading.querySelectorAll(".ld-rows-row")).toHaveLength(4);
  },
};

export const RecentTasksLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/admin/background-tasks", 500));
  },
  render: () => <RecentTasksCard />,
  play: async ({ canvas }) => {
    const status = await canvas.findByText("Couldn’t load the task history.");
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("background-tasks-table"),
    ).not.toBeInTheDocument();
  },
};

export const RecentTasksTryAgainReadsTheHistoryAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get("/api/admin/background-tasks", () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json([aWireBackgroundTask()]),
      ),
    );
  },
  render: () => <RecentTasksCard />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await expect(
      await canvas.findByTestId("background-tasks-table"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("Couldn’t load the task history."),
    ).not.toBeInTheDocument();
  },
};

export const RecentTasksEmpty: Story = {
  beforeEach({ msw }) {
    msw.use(backgroundTasksHandler(() => []));
  },
  render: () => <RecentTasksCard />,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "No background tasks have run since this history began.",
      ),
    ).toBeInTheDocument();
  },
};

export const RecentTasksRows: Story = {
  beforeEach({ msw }) {
    msw.use(
      backgroundTasksHandler(() => [
        aWireBackgroundTask({ id: 4 }),
        aWireBackgroundTask({
          id: 3,
          task_kind: "rewrite_all_epubs",
          status: "failed",
          finished_at: 1_700_000_200,
          error: "disk full",
        }),
        aWireBackgroundTask({
          id: 2,
          task_kind: "backfill_chapters",
          status: "running",
          finished_at: null,
        }),
        aWireBackgroundTask({ id: 1, task_kind: "prune_old_things" }),
      ]),
    );
  },
  render: () => <RecentTasksCard />,
  play: async ({ canvas }) => {
    const region = await canvas.findByRole("region", {
      name: "Recent background tasks",
    });
    const rows = within(region).getAllByTestId("background-tasks-row");
    await expect(rows.map((row) => row.textContent)).toEqual([
      "2023-11-14 22:13:20 UTC SUCCESS Library scan 45s",
      "2023-11-14 22:13:20 UTC FAILED EPUB override bake 3m 20s disk full",
      "2023-11-14 22:13:20 UTC RUNNING Audiobook chapter extraction running…",
      "2023-11-14 22:13:20 UTC SUCCESS Prune old things 45s",
    ]);
    await expect(rows[0]?.querySelector(".logs-level")).toHaveClass(
      "logs-level-info",
    );
    await expect(rows[1]?.querySelector(".logs-level")).toHaveClass(
      "logs-level-error",
    );
    await expect(
      within(region).getByTestId("background-tasks-row-error"),
    ).toHaveTextContent("disk full");
  },
};

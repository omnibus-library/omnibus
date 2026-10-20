import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { getGetWorkerStatusMockHandler200 } from "../../api/generated/omnibus.msw";
import {
  aWireTaskProgress,
  aWireWorkerStatus,
} from "../../testing/adminHandlers";
import { WorkerStatus } from "./WorkerStatus";

const TALLIES = {
  found: 340,
  new: 3,
  changed: 0,
  removed: 2,
  moved: 0,
  unchanged: 335,
};

const finished = (overrides = {}) =>
  aWireTaskProgress({
    task_id: 7,
    state: { state: "done", processed: 340 },
    detail: { tallies: TALLIES },
    ...overrides,
  });

let feed = aWireWorkerStatus();
let polls = 0;

const meta = {
  title: "Components/WorkerStatus",
  component: WorkerStatus,
  beforeEach({ msw }) {
    feed = aWireWorkerStatus();
    polls = 0;
    msw.use(
      getGetWorkerStatusMockHandler200(() => {
        polls += 1;
        return feed;
      }),
    );
  },
} satisfies Meta<typeof WorkerStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  play: async ({ canvas }) => {
    // The second poll lands only after the first answer has been rendered.
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(2));
    await expect(canvas.queryByTestId("worker-status")).not.toBeInTheDocument();
  },
};

export const ShowsARunningScan: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({
      active: [
        aWireTaskProgress({
          state: { state: "running", processed: 12, total: 340 },
          detail: {
            phase: "Walking the library",
            current_item: "books/Author/Title.epub",
            tallies: TALLIES,
          },
        }),
      ],
    });
  },
  play: async ({ canvas }) => {
    const strip = await canvas.findByTestId("worker-status");
    await expect(strip).toHaveAttribute("role", "status");
    await expect(strip).toHaveAttribute("aria-live", "polite");
    await expect(
      await canvas.findByText("Scanning library (12 / 340)"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("worker-status-phase")).toHaveTextContent(
      "Walking the library",
    );
    await expect(canvas.getByTestId("worker-status-item")).toHaveTextContent(
      "books/Author/Title.epub",
    );
    await expect(canvas.getByTestId("worker-status-tallies")).toHaveTextContent(
      "Found 340 — 3 new · 2 removed",
    );
    await expect(
      canvas.queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
  },
};

export const ShowsATaskThatHasNotCountedItsWork: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({
      active: [aWireTaskProgress({ kind: "generate_thumbs" })],
    });
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Generating thumbnail"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("worker-status-phase"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("worker-status-tallies"),
    ).not.toBeInTheDocument();
  },
};

export const ListsRunningTasksBeforeFinishedOnes: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({
      active: [aWireTaskProgress({ task_id: 8, kind: "generate_thumbs" })],
      recent_complete: [finished()],
    });
  },
  play: async ({ canvas }) => {
    const running = await canvas.findByText("Generating thumbnail");
    const done = canvas.getByText("Library scan");
    await expect(
      running.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

export const PicksUpATaskThatStartsLater: Story = {
  play: async ({ canvas }) => {
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(1));
    feed = aWireWorkerStatus({ active: [aWireTaskProgress({ task_id: 9 })] });

    await expect(
      await canvas.findByText("Scanning library"),
    ).toBeInTheDocument();
    await expect(polls).toBeGreaterThanOrEqual(2);
  },
};

export const ShowsAFinishedScan: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({ recent_complete: [finished()] });
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Library scan")).toBeInTheDocument();
    await expect(canvas.getByTestId("worker-status-summary")).toHaveTextContent(
      "3 new · 2 removed",
    );
    await expect(
      canvas.getByRole("button", { name: "Dismiss" }),
    ).toBeInTheDocument();
  },
};

export const ShowsAWarningForLostFiles: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({
      recent_complete: [
        finished({
          state: {
            state: "done",
            processed: 340,
            ghost_warning: { removed: 15, total: 100 },
          },
        }),
      ],
    });
  },
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("worker-status-warn-row");
    await expect(row).toHaveTextContent("Library scan finished with a warning");
    await expect(row).toHaveTextContent(
      "15 of 100 books lost their files in this scan — check that your library path is mounted.",
    );
    await expect(
      canvas.getByRole("button", { name: "Dismiss" }),
    ).toBeInTheDocument();
  },
};

export const ShowsBakeErrors: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({
      recent_complete: [
        finished({
          state: {
            state: "done",
            processed: 40,
            bake_errors: ["uuid-a", "uuid-b"],
          },
        }),
      ],
    });
  },
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("worker-status-bake-errors-row");
    await expect(row).toHaveTextContent(
      "EPUB override bake finished with errors",
    );
    await expect(row).toHaveTextContent(
      "2 books failed to bake: uuid-a, uuid-b.",
    );
    await expect(
      canvas.getByRole("button", { name: "Dismiss" }),
    ).toBeInTheDocument();
  },
};

export const ShowsAnEmptyBakeErrorListAsDone: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({
      recent_complete: [
        finished({ state: { state: "done", processed: 40, bake_errors: [] } }),
      ],
    });
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Library scan")).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("worker-status-bake-errors-row"),
    ).not.toBeInTheDocument();
  },
};

export const ShowsAFailedTaskAsAnAlert: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({
      recent_complete: [
        finished({ state: { state: "failed", message: "disk full" } }),
      ],
    });
  },
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("Library scan failed");
    await expect(alert).toHaveTextContent("disk full");
    await expect(
      canvas.getByRole("button", { name: "Dismiss" }),
    ).toBeInTheDocument();
  },
};

export const DismissesAFinishedTask: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({ recent_complete: [finished()] });
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Dismiss" }),
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("worker-status")).not.toBeInTheDocument(),
    );

    // The server still lists it, and later polls leave it hidden.
    const seen = polls;
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(seen + 2));
    await expect(canvas.queryByTestId("worker-status")).not.toBeInTheDocument();
  },
};

export const ShowsADismissedTaskAgainOnceTheServerDroppedIt: Story = {
  beforeEach() {
    feed = aWireWorkerStatus({ recent_complete: [finished()] });
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Dismiss" }),
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("worker-status")).not.toBeInTheDocument(),
    );

    feed = aWireWorkerStatus();
    const seen = polls;
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(seen + 2));
    // After a server restart a new task can reuse the id.
    feed = aWireWorkerStatus({ recent_complete: [finished()] });

    await expect(await canvas.findByText("Library scan")).toBeInTheDocument();
  },
};

let failPolls = false;

export const KeepsTheLastFeedThroughAFailedPoll: Story = {
  beforeEach({ msw }) {
    failPolls = false;
    feed = aWireWorkerStatus({ active: [aWireTaskProgress()] });
    msw.use(
      http.get("/api/worker/status", () => {
        polls += 1;
        return failPolls
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(feed);
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Scanning library"),
    ).toBeInTheDocument();
    failPolls = true;
    const seen = polls;
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(seen + 2));

    await expect(canvas.getByText("Scanning library")).toBeInTheDocument();
  },
};

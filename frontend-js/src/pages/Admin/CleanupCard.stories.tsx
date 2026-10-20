import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import {
  aWireCleanupCounts,
  cleanupCountsHandler,
  cleanupDetectHandler,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { CleanupCard } from "./CleanupCard";

const DETECT = "/api/admin/cleanup/detect";
const COUNTS = "/api/admin/cleanup/counts";

let detections = 0;

const meta = {
  title: "Pages/Admin/CleanupCard",
  component: CleanupCard,
  beforeEach({ msw }) {
    detections = 0;
    msw.use(
      cleanupCountsHandler(aWireCleanupCounts),
      cleanupDetectHandler(() => {
        detections += 1;
      }),
    );
  },
} satisfies Meta<typeof CleanupCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(COUNTS));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Suggested fixes" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByTestId("cleanup-counts-loading"),
    ).toHaveTextContent("Counting what needs tidying…");
    await expect(canvas.queryByTestId("cleanup-kinds")).not.toBeInTheDocument();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", COUNTS, 500));
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByText("Couldn’t load the cleanup counts.");
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("cleanup-kinds")).not.toBeInTheDocument();
  },
};

export const TryAgainReadsTheCountsAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(COUNTS, () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireCleanupCounts()),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await expect(
      await canvas.findByTestId("cleanup-kinds"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("Couldn’t load the cleanup counts."),
    ).not.toBeInTheDocument();
  },
};

export const ListsEachKindWithItsPendingCount: Story = {
  play: async ({ canvas }) => {
    const list = await canvas.findByTestId("cleanup-kinds");
    const rows = within(list).getAllByRole("listitem");
    await expect(rows.map((row) => row.textContent)).toEqual([
      "Authors3 pendingReview",
      "Series0 pendingReview",
      "Tags4 pendingReview",
      "Book titles7 pendingReview",
    ]);
    for (const [name, href] of [
      ["Review authors", "/admin/cleanup/author"],
      ["Review series", "/admin/cleanup/series"],
      ["Review tags", "/admin/cleanup/tag"],
      ["Review book titles", "/admin/cleanup/book_title"],
    ]) {
      await expect(canvas.getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
  },
};

export const RunsDetectionAndReadsTheCountsAgain: Story = {
  beforeEach({ msw }) {
    msw.use(
      cleanupCountsHandler(() =>
        detections === 0
          ? aWireCleanupCounts()
          : [
              {
                kind: "author",
                counts: { pending: 9, accepted: 1, rejected: 0 },
              },
              ...aWireCleanupCounts().slice(1),
            ],
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-kinds");
    await userEvent.click(
      canvas.getByRole("button", { name: "Run detection now" }),
    );

    const status = await canvas.findByText(
      "Detection started. Counts update as it finishes.",
    );
    await expect(status).toHaveClass("settings-status");
    await expect(detections).toBe(1);
    await waitFor(() =>
      expect(canvas.getByTestId("cleanup-count-author")).toHaveTextContent(
        "9 pending",
      ),
    );
  },
};

let detectGate = deferred();

export const HoldsTheButtonWhileStarting: Story = {
  beforeEach({ msw }) {
    detectGate = deferred();
    msw.use(
      http.post(DETECT, async () => {
        await detectGate.promise;
        return new HttpResponse(null, { status: 202 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-kinds");
    await userEvent.click(
      canvas.getByRole("button", { name: "Run detection now" }),
    );

    const busy = await canvas.findByRole("button", { name: "Starting…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    detectGate.release();
    await expect(
      await canvas.findByText(
        "Detection started. Counts update as it finishes.",
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Run detection now" }),
    ).toBeEnabled();
  },
};

export const ShowsADetectionRefusal: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", DETECT, 500));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-kinds");
    await userEvent.click(
      canvas.getByRole("button", { name: "Run detection now" }),
    );

    const status = await canvas.findByText(
      "Couldn’t start detection: failed with 500",
    );
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByRole("button", { name: "Run detection now" }),
    ).toBeEnabled();
  },
};

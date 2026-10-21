import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { deferred } from "../../testing/handlers";
import { CleanupReview } from "./CleanupReview";
import {
  decided,
  progressText,
  QUEUE,
  ReviewRoute,
  reads,
  renaming,
  resetReview,
  TAG_QUEUE,
  undone,
} from "./CleanupReview.stories.shared";

const meta = {
  title: "Pages/CleanupReview/Undo",
  component: CleanupReview,
  parameters: { path: "/admin/cleanup/tag" },
  render: ReviewRoute,
  beforeEach: resetReview,
} satisfies Meta<typeof CleanupReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnAppliedAcceptOffersToUndoIt: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await expect(canvas.queryByTestId("cleanup-undo-bar")).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));

    const bar = await canvas.findByTestId("cleanup-undo-bar");
    await expect(bar).toHaveTextContent("Merged into “Science Fiction”.");
    await expect(
      within(bar).getByRole("button", { name: "Undo" }),
    ).toBeEnabled();
  },
};

export const ARejectLeavesTheEarlierUndoOffer: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));
    await canvas.findByTestId("cleanup-undo-bar");

    await userEvent.click(canvas.getByRole("button", { name: "Reject (N)" }));

    await canvas.findByText("Merge these tags into one.");
    await expect(canvas.getByTestId("cleanup-undo-bar")).toHaveTextContent(
      "Merged into “Science Fiction”.",
    );
    await expect(decided.map((entry) => entry.request.decision)).toEqual([
      "accepted",
      "rejected",
    ]);
  },
};

let undoGate = deferred();

let requeueGate = deferred();

export const UndoReadsTheQueueAndCountsAgain: Story = {
  beforeEach({ msw }) {
    undoGate = deferred();
    requeueGate = deferred();
    msw.use(
      http.post("/api/admin/cleanup/undo/:logId", async ({ params }) => {
        undone.push(Number(params.logId));
        await undoGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(TAG_QUEUE, async () => {
        reads.queue += 1;
        if (reads.queue > 1) await requeueGate.promise;
        return HttpResponse.json(QUEUE);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));
    await canvas.findByText("Split this tag into its parts.");
    await expect(reads.counts).toBe(1);

    await userEvent.click(await canvas.findByRole("button", { name: "Undo" }));

    const busy = await canvas.findByRole("button", { name: "Undoing…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(
      canvas.getByRole("button", { name: "Skip (Space)" }),
    ).toBeDisabled();
    undoGate.release();
    await expect(await canvas.findByTestId("cleanup-undone")).toHaveTextContent(
      "Change undone. The library is back as it was.",
    );
    await expect(undone).toEqual([101]);
    // The queue reads again from the top, so the reopened card returns first.
    await expect(
      await canvas.findByTestId("cleanup-review-loading"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("cleanup-card")).toBeNull();
    requeueGate.release();
    await expect(
      await canvas.findByText("Merge these tags into one."),
    ).toBeInTheDocument();
    await expect(progressText(canvas)).toContain("1 of 3");
    await waitFor(() => expect(reads.counts).toBe(2));
    await expect(canvas.queryByTestId("cleanup-undo-bar")).toBeNull();
  },
};

export const ShowsAnUndoRefusalAndKeepsTheOffer: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/admin/cleanup/undo/:logId",
        () => new HttpResponse("log entry not found", { status: 409 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Undo" }));

    await expect(
      await canvas.findByTestId("cleanup-review-error"),
    ).toHaveTextContent("log entry not found");
    await expect(canvas.getByTestId("cleanup-undo-bar")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Undo" })).toBeEnabled();
    await expect(reads.queue).toBe(1);
  },
};

export const IgnoresKeysWhileAnUndoIsOut: Story = {
  beforeEach({ msw }) {
    undoGate = deferred();
    msw.use(
      http.post("/api/admin/cleanup/undo/:logId", async ({ params }) => {
        undone.push(Number(params.logId));
        await undoGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const column = await canvas.findByTestId("cleanup-review");
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Undo" }));
    await canvas.findByRole("button", { name: "Undoing…" });

    for (const key of ["y", "n", " "]) fireEvent.keyDown(column, { key });

    await expect(decided).toHaveLength(1);
    await expect(progressText(canvas)).toContain("2 of 3");
    undoGate.release();
    await canvas.findByTestId("cleanup-undone");
  },
};

export const KeepsTheHotkeysWorkingAfterAnUndo: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.keyboard("y");
    await userEvent.click(await canvas.findByRole("button", { name: "Undo" }));
    await canvas.findByTestId("cleanup-undone");
    await canvas.findByText("Merge these tags into one.");

    await userEvent.keyboard("y");

    await waitFor(() => expect(decided).toHaveLength(2));
    await expect(canvas.getByTestId("cleanup-review")).toHaveFocus();
  },
};

export const CountsAnEditedAcceptAndAnUndoneChange: Story = renaming(
  async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await userEvent.type(input, "!");
    await userEvent.click(
      canvas.getByRole("button", { name: "Accept edited title (Y)" }),
    );
    await userEvent.click(await canvas.findByRole("button", { name: "Undo" }));
    await canvas.findByTestId("cleanup-undone");
    await canvas.findByRole("textbox", { name: "Proposed title" });

    await userEvent.click(canvas.getByRole("button", { name: "Skip (Space)" }));
    await userEvent.click(canvas.getByRole("button", { name: "Skip (Space)" }));

    await expect(
      within(await canvas.findByTestId("cleanup-tally"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      "1accepted with your wording",
      "2skipped — comes back next pass",
      "1undone",
    ]);
  },
);

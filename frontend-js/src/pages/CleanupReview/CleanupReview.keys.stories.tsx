import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { cleanupDecisionHandler } from "../../testing/adminHandlers";
import { deferred } from "../../testing/handlers";
import { CleanupReview } from "./CleanupReview";
import {
  decided,
  progressText,
  ReviewRoute,
  renaming,
  resetReview,
  undone,
} from "./CleanupReview.stories.shared";

const meta = {
  title: "Pages/CleanupReview/Keys",
  component: CleanupReview,
  parameters: { path: "/admin/cleanup/tag" },
  render: ReviewRoute,
  beforeEach: resetReview,
} satisfies Meta<typeof CleanupReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const YAcceptsTheCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");

    await userEvent.keyboard("y");

    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([
      { id: 1, request: { decision: "accepted" } },
    ]);
  },
};

export const ShiftedNRejectsTheCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");

    await userEvent.keyboard("N");

    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([
      { id: 1, request: { decision: "rejected" } },
    ]);
  },
};

export const SpaceSkipsWithoutScrollingOrARequest: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("cleanup-card");

    // `fireEvent` answers false when the page cancelled the key's default, which is the scroll.
    const notCancelled = fireEvent.keyDown(
      canvas.getByTestId("cleanup-review"),
      {
        key: " ",
      },
    );

    await expect(notCancelled).toBe(false);
    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([]);
  },
};

export const OtherKeysDoNothing: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");

    await userEvent.keyboard("q{Enter}{ArrowRight}");
    await userEvent.keyboard("{Control>}y{/Control}");

    await expect(canvas.getByText("Merge these tags into one.")).toBeVisible();
    await expect(decided).toEqual([]);
  },
};

let heldGate = deferred();

export const HeldKeysDecideTheCardOnce: Story = {
  beforeEach({ msw }) {
    heldGate = deferred();
    msw.use(cleanupDecisionHandler({ decided, until: heldGate.promise }));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");

    await userEvent.keyboard("yyy");
    await waitFor(() => expect(decided).toHaveLength(1));
    heldGate.release();
    await canvas.findByText("Split this tag into its parts.");

    await expect(decided).toHaveLength(1);
    await expect(progressText(canvas)).toContain("2 of 3");
  },
};

/** A story that holds every decision until `heldGate` is released. */
const holdingDecisions = (play: Story["play"]): Story => ({
  beforeEach({ msw }) {
    heldGate = deferred();
    msw.use(cleanupDecisionHandler({ decided, until: heldGate.promise }));
  },
  play,
});

/** Y, then `second`, dispatched in one task so no render lands between them. */
const yThen = (second: string) =>
  holdingDecisions(async ({ canvas }) => {
    const column = await canvas.findByTestId("cleanup-review");
    await canvas.findByTestId("cleanup-card");

    fireEvent.keyDown(column, { key: "y" });
    fireEvent.keyDown(column, { key: second });

    await waitFor(() => expect(decided).toHaveLength(1));
    await expect(progressText(canvas)).toContain("1 of 3");
    heldGate.release();
    await canvas.findByText("Split this tag into its parts.");
    await expect(decided).toEqual([
      { id: 1, request: { decision: "accepted" } },
    ]);
    await expect(progressText(canvas)).toContain("2 of 3");
  });

export const YThenYInOneTaskDecidesTheCardOnce = yThen("y");

export const YThenNInOneTaskDecidesTheCardOnce = yThen("n");

export const YThenSpaceInOneTaskDoesNotSkipTheNextCard = yThen(" ");

export const IgnoresAHeldDecisionKey: Story = {
  play: async ({ canvas, userEvent }) => {
    const column = await canvas.findByTestId("cleanup-review");
    await canvas.findByTestId("cleanup-card");
    await userEvent.keyboard("y");
    await canvas.findByText("Split this tag into its parts.");

    fireEvent.keyDown(column, { key: "y", repeat: true });
    fireEvent.keyDown(column, { key: "n", repeat: true });
    // A fresh press still decides the card the repeats left alone.
    await userEvent.keyboard("n");

    await waitFor(() => expect(progressText(canvas)).toContain("3 of 3"));
    await expect(decided).toEqual([
      { id: 1, request: { decision: "accepted" } },
      { id: 2, request: { decision: "rejected" } },
    ]);
  },
};

export const IgnoresAHeldSpaceButStillStopsTheScroll: Story = {
  play: async ({ canvas, userEvent }) => {
    const column = await canvas.findByTestId("cleanup-review");
    await canvas.findByTestId("cleanup-card");
    await userEvent.keyboard(" ");
    await canvas.findByText("Split this tag into its parts.");

    const notCancelled = fireEvent.keyDown(column, { key: " ", repeat: true });

    await expect(notCancelled).toBe(false);
    await expect(progressText(canvas)).toContain("2 of 3");
  },
};

export const SpaceOnTheFocusedRejectButtonRejectsTheCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    canvas.getByRole("button", { name: "Reject (N)" }).focus();

    await userEvent.keyboard(" ");

    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([
      { id: 1, request: { decision: "rejected" } },
    ]);
    await expect(progressText(canvas)).toContain("2 of 3");
  },
};

export const SpaceOnTheFocusedUndoButtonUndoesTheChange: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));
    const undo = await canvas.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(undo).toBeEnabled());
    undo.focus();

    await userEvent.keyboard(" ");

    await expect(await canvas.findByTestId("cleanup-undone")).toBeVisible();
    await expect(undone).toEqual([101]);
  },
};

export const YOnAFocusedButtonAcceptsTheCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Skip (Space)" }));
    await canvas.findByText("Split this tag into its parts.");
    await expect(
      canvas.getByRole("button", { name: "Skip (Space)" }),
    ).toHaveFocus();

    await userEvent.keyboard("y");

    await expect(
      await canvas.findByText("Merge these tags into one."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([
      { id: 2, request: { decision: "accepted" } },
    ]);
  },
};

export const EnterOnAFocusedButtonPressesIt: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    canvas.getByRole("button", { name: "Reject (N)" }).focus();

    await userEvent.keyboard("{Enter}");

    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([
      { id: 1, request: { decision: "rejected" } },
    ]);
  },
};

export const IgnoresAnEnterHeldDownInTheProposal: Story = renaming(
  async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await userEvent.type(input, " (1818)");

    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    await userEvent.type(input, "!{Enter}");

    await canvas.findByDisplayValue("Emma");
    await expect(decided).toEqual([
      {
        id: 11,
        request: { decision: "accepted", value: "Frankenstein (1818)!" },
      },
    ]);
  },
);

export const IgnoresAnEnterThatConfirmsAnImeComposition: Story = renaming(
  async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await userEvent.type(input, " (18");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    await userEvent.type(input, "18){Enter}");

    await expect(await canvas.findByDisplayValue("Emma")).toBeInTheDocument();
    await expect(decided).toEqual([
      {
        id: 11,
        request: { decision: "accepted", value: "Frankenstein (1818)" },
      },
    ]);
  },
);

export const HotkeysDoNothingPastTheLastCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.keyboard("   ");
    await canvas.findByTestId("cleanup-card-done");

    await userEvent.keyboard(" yn ");

    await expect(decided).toEqual([]);
    await expect(
      within(canvas.getByTestId("cleanup-tally"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["3skipped — comes back next pass"]);
  },
};

export const TypingInTheProposalNeverFiresAHotkey: Story = renaming(
  async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await userEvent.clear(input);

    await userEvent.type(input, "Yes, no: a title ");

    await expect(input).toHaveValue("Yes, no: a title ");
    await expect(decided).toEqual([]);
    await expect(progressText(canvas)).toContain("1 of 2");
  },
);

export const EnterInTheProposalAcceptsTheWording: Story = renaming(
  async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await userEvent.type(input, " (1818){Enter}");

    await expect(await canvas.findByDisplayValue("Emma")).toBeInTheDocument();
    await expect(decided).toEqual([
      {
        id: 11,
        request: { decision: "accepted", value: "Frankenstein (1818)" },
      },
    ]);
  },
);

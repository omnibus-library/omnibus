import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { getGetCleanupQueueMockHandler200 } from "../../api/generated/omnibus.msw";
import { storyClient } from "../../testing/AppHarness";
import {
  aWireSuggestion,
  cleanupDecisionHandler,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { WIRE_ADA } from "../../testing/wire";
import { CleanupReview } from "./CleanupReview";
import {
  decided,
  ReviewRoute,
  reads,
  renaming,
  resetReview,
  SPLIT,
  TAG_QUEUE,
} from "./CleanupReview.stories.shared";

const READER = { ...WIRE_ADA, is_admin: false };
const COUNTS = "/api/admin/cleanup/counts";
const DECISION = "/api/admin/cleanup/suggestions/:id/decision";

const meta = {
  title: "Pages/CleanupReview",
  component: CleanupReview,
  parameters: { path: "/admin/cleanup/tag" },
  render: ReviewRoute,
  beforeEach: resetReview,
} satisfies Meta<typeof CleanupReview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every admin query the page has started, by key: none for a refused or unknown page. */
const adminQueries = () =>
  storyClient()
    .getQueryCache()
    .findAll({ queryKey: ["admin"] })
    .map((query) => query.queryKey);

export const ShowsTheCrumbAndHeading: Story = {
  play: async ({ canvas }) => {
    const crumb = await canvas.findByRole("navigation", {
      name: "breadcrumb",
    });
    await expect(crumb).toHaveTextContent("Administration›Cleanup›Review tags");
    await expect(
      within(crumb).getByRole("link", { name: "Administration" }),
    ).toHaveAttribute("href", "/admin");
    await expect(
      within(crumb).getByRole("link", { name: "Cleanup" }),
    ).toHaveAttribute("href", "/admin?section=cleanup");
    await expect(within(crumb).getByText("Review tags")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Review tags" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe("Omnibus | Library cleanup"),
    );
  },
};

export const FocusesTheColumn: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("cleanup-card");
    await expect(canvas.getByTestId("cleanup-review")).toHaveFocus();
  },
};

export const ShowsTheProgressWithOneDotPerCard: Story = {
  play: async ({ canvas }) => {
    const progress = await canvas.findByTestId("cleanup-progress");
    await expect(progress).toHaveTextContent("1 of 3");
    await expect(
      [...progress.querySelectorAll(".crx-dot")].map((dot) => dot.className),
    ).toEqual(["crx-dot on", "crx-dot", "crx-dot"]);
  },
};

export const ListsTheKindsAsChipsWithTheirCounts: Story = {
  play: async ({ canvas }) => {
    const line = await canvas.findByTestId("cleanup-kindline");
    await waitFor(() =>
      expect(
        within(line)
          .getAllByRole("link")
          .map((chip) => chip.textContent),
      ).toEqual(["Authors3", "Series0", "Tags4", "Book titles7"]),
    );
    for (const kind of ["author", "series", "tag", "book_title"]) {
      const chip = canvas.getByTestId(`cleanup-kindchip-${kind}`);
      await expect(chip).toHaveAttribute("href", `/admin/cleanup/${kind}`);
      await expect(chip).toHaveAttribute(
        "aria-current",
        kind === "tag" ? "page" : "false",
      );
    }
    await expect(canvas.getByTestId("cleanup-kindchip-tag")).toHaveClass(
      "crx-kindchip",
      "on",
    );
  },
};

export const LeavesTheChipsWithoutCountsWhenTheyFailToLoad: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", COUNTS, 500));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("cleanup-card");
    await waitFor(() =>
      expect(
        storyClient().getQueryState(["admin", "cleanup", "counts"])?.status,
      ).toBe("error"),
    );
    await expect(
      within(canvas.getByTestId("cleanup-kindline"))
        .getAllByRole("link")
        .map((chip) => chip.textContent),
    ).toEqual(["Authors", "Series", "Tags", "Book titles"]);
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(TAG_QUEUE));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("cleanup-review-loading"),
    ).toHaveTextContent("Gathering the suggestions…");
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Review tags" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("cleanup-progress"),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("cleanup-card")).not.toBeInTheDocument();
  },
};

export const QueueLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", TAG_QUEUE, 500));
  },
  play: async ({ canvas }) => {
    const error = await canvas.findByTestId("cleanup-review-error");
    await expect(error).toHaveTextContent("failed with 500");
    await expect(error).toHaveClass("settings-status", "error");
    await expect(canvas.queryByTestId("cleanup-card")).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("cleanup-card-done"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("cleanup-review-loading"),
    ).not.toBeInTheDocument();
  },
};

export const RefusesAReaderWithoutAnyAdminChrome: Story = {
  parameters: { user: READER },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("cleanup-review-forbidden"),
    ).toHaveTextContent(
      "Administrator access is required to review library cleanup.",
    );
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Review tags" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("navigation")).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("cleanup-kindline"),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
    // Neither read was started, so a reader never reaches the admin routes.
    await expect(adminQueries()).toEqual([]);
    await expect(reads.queue).toBe(0);
  },
};

export const ReportsAnUnknownKindAndFetchesNothing: Story = {
  parameters: { path: "/admin/cleanup/duplicates" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("cleanup-review-unknown-kind"),
    ).toHaveTextContent("Unknown cleanup kind.");
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Review library cleanup" }),
    ).toBeInTheDocument();
    await expect(
      within(canvas.getByTestId("cleanup-kindline"))
        .getAllByRole("link")
        .map((chip) => chip.getAttribute("aria-current")),
    ).toEqual(["false", "false", "false", "false"]);
    await expect(
      canvas.queryByTestId("cleanup-card-done"),
    ).not.toBeInTheDocument();
    await expect(adminQueries()).toEqual([]);
  },
};

export const ShowsAMergeWithEverySourceStruckThrough: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("cleanup-card-action"),
    ).toHaveTextContent("Merge these tags into one.3 books affected");
    const scanned = canvas.getByTestId("cleanup-card-scanned");
    await expect(
      within(scanned)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Sci-Fi", "SciFi", "Science-Fiction"]);
    for (const name of ["Sci-Fi", "SciFi", "Science-Fiction"]) {
      await expect(within(scanned).getByText(name)).toHaveClass(
        "crx-merge-name",
        "crx-strike",
      );
    }
    await expect(canvas.getByText("Merging away")).toBeInTheDocument();
    await expect(canvas.getByText("Surviving name")).toBeInTheDocument();
    const proposed = canvas.getByTestId("cleanup-card-proposed");
    await expect(proposed).toHaveTextContent("Science Fiction");
    await expect(proposed).toHaveClass("crx-proposed", "crx-proposed-static");
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

export const CountsOneBookInTheSingular: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetCleanupQueueMockHandler200(() => [
        aWireSuggestion({ book_count: 1 }),
      ]),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("cleanup-card-books"),
    ).toHaveTextContent("1 book affected");
  },
};

export const ShowsABookTitleRenameAsAnInput: Story = {
  parameters: { path: "/admin/cleanup/book_title" },
  beforeEach({ msw }) {
    msw.use(
      getGetCleanupQueueMockHandler200(() => [
        aWireSuggestion({
          kind: "book_title",
          action: "rename",
          primary_name: "Shelley, Mary - Frankenstein",
          secondary_name: "Frankenstein",
          source_names: [],
          book_count: 1,
        }),
      ]),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Adopt the normalized title."),
    ).toBeInTheDocument();
    const scanned = canvas.getByTestId("cleanup-card-scanned");
    await expect(scanned).toHaveTextContent("Shelley, Mary - Frankenstein");
    await expect(scanned).toHaveClass("crx-current", "crx-strike");
    await expect(canvas.getByText("Scanned title")).toBeInTheDocument();
    await expect(canvas.getByText("Proposed title")).toBeInTheDocument();
    const input = canvas.getByRole("textbox", { name: "Proposed title" });
    await expect(input).toHaveValue("Frankenstein");
    await expect(input).toHaveClass("crx-proposed");
    await expect(
      canvas.queryByTestId("cleanup-card-proposed"),
    ).not.toBeInTheDocument();
  },
};

export const ShowsASplitAsItsParts: Story = {
  beforeEach({ msw }) {
    msw.use(getGetCleanupQueueMockHandler200(() => [SPLIT]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    const scanned = canvas.getByTestId("cleanup-card-scanned");
    await expect(scanned).toHaveTextContent("Fiction; Poland");
    await expect(scanned).toHaveClass("crx-strike");
    await expect(canvas.getByText("Scanned tag")).toBeInTheDocument();
    await expect(canvas.getByText("Splits into")).toBeInTheDocument();
    const parts = canvas.getByTestId("cleanup-card-proposed");
    await expect(
      [...parts.children].map((part) => [part.textContent, part.className]),
    ).toEqual([
      ["Fiction", "chip crx-part"],
      ["Poland", "chip crx-part"],
    ]);
  },
};

export const ShowsADeleteAsTheRecordAlone: Story = {
  parameters: { path: "/admin/cleanup/author" },
  beforeEach({ msw }) {
    msw.use(
      getGetCleanupQueueMockHandler200(() => [
        aWireSuggestion({
          kind: "author",
          action: "delete",
          primary_name: "calibre (0.7.23)",
          secondary_name: null,
          source_names: [],
          book_count: 4,
        }),
      ]),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Delete this author record."),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Record")).toBeInTheDocument();
    await expect(canvas.getByTestId("cleanup-card-scanned")).toHaveTextContent(
      "calibre (0.7.23)",
    );
    await expect(canvas.getAllByText("calibre (0.7.23)")).toHaveLength(1);
    await expect(
      canvas.queryByTestId("cleanup-card-proposed"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByTestId("cleanup-card-scanned").closest(".crx-proposal"),
    ).toHaveClass("crx-proposal-solo");
    await expect(
      canvas.getByTestId("cleanup-card").querySelector(".crx-arrow"),
    ).toBeNull();
    await expect(canvas.getByTestId("cleanup-hint")).toHaveTextContent(
      "Nothing replaces it — accepting removes the record and blocklists the name — Y accepts, N rejects, Space skips it for this pass.",
    );
  },
};

export const ShowsThePhotoAndTheHotkeyHint: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetCleanupQueueMockHandler200(() => [
        aWireSuggestion({ photo_url: "/api/covers/author-1" }),
      ]),
    );
  },
  play: async ({ canvas }) => {
    const photo = await canvas.findByTestId("cleanup-card-photo");
    await expect(photo).toHaveAttribute("src", "/api/covers/author-1");
    await expect(photo).toHaveAttribute("alt", "Photo of Science Fiction");
    const hint = canvas.getByTestId("cleanup-hint");
    await expect(hint).toHaveTextContent(
      "Editing the proposal isn't wired up for this kind yet — Y accepts, N rejects, Space skips it for this pass.",
    );
    await expect(
      [...hint.querySelectorAll("kbd")].map((key) => key.textContent),
    ).toEqual(["Y", "N", "Space"]);
  },
};

export const AcceptSendsTheDecisionAndShowsTheNextCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));

    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([
      { id: 1, request: { decision: "accepted" } },
    ]);
    await expect(canvas.getByTestId("cleanup-progress")).toHaveTextContent(
      "2 of 3",
    );
  },
};

export const RejectSendsTheDecisionAndShowsTheNextCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Reject (N)" }));

    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(decided).toEqual([
      { id: 1, request: { decision: "rejected" } },
    ]);
  },
};

export const SkipShowsTheNextCardWithoutARequest: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Skip (Space)" }));

    await expect(
      await canvas.findByText("Split this tag into its parts."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cleanup-progress")).toHaveTextContent(
      "2 of 3",
    );
    await expect(decided).toEqual([]);
  },
};

let decisionGate = deferred();

export const HoldsAllThreeButtonsWhileADecisionIsOut: Story = {
  beforeEach({ msw }) {
    decisionGate = deferred();
    msw.use(cleanupDecisionHandler({ decided, until: decisionGate.promise }));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));

    for (const name of ["Accept (Y)", "Reject (N)", "Skip (Space)"]) {
      await expect(canvas.getByRole("button", { name })).toBeDisabled();
    }
    decisionGate.release();
    await canvas.findByText("Split this tag into its parts.");
    for (const name of ["Accept (Y)", "Reject (N)", "Skip (Space)"]) {
      await expect(canvas.getByRole("button", { name })).toBeEnabled();
    }
  },
};

export const ShowsARefusalAndStaysOnTheCard: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        DECISION,
        () => new HttpResponse("suggestion not found", { status: 409 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));

    const error = await canvas.findByTestId("cleanup-review-error");
    await expect(error).toHaveTextContent("suggestion not found");
    await expect(error).toHaveClass("settings-status", "error");
    await expect(
      canvas.getByText("Merge these tags into one."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cleanup-progress")).toHaveTextContent(
      "1 of 3",
    );
    await expect(
      canvas.getByRole("button", { name: "Accept (Y)" }),
    ).toBeEnabled();
  },
};

export const ShowsTheEndOfThePassPastTheLastCard: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    for (let card = 0; card < 3; card += 1) {
      await userEvent.click(
        canvas.getByRole("button", { name: "Skip (Space)" }),
      );
    }

    const done = await canvas.findByTestId("cleanup-card-done");
    await expect(done).toHaveTextContent("No suggestions pending.");
    await expect(done).toHaveTextContent(
      "The most recent change you applied can be undone from this page.",
    );
    await expect(canvas.queryByTestId("cleanup-card")).not.toBeInTheDocument();
    const progress = canvas.getByTestId("cleanup-progress");
    await expect(progress).toHaveTextContent("3 of 3");
    await expect(
      [...progress.querySelectorAll(".crx-dot")].map((dot) => dot.className),
    ).toEqual(["crx-dot done", "crx-dot done", "crx-dot done"]);
  },
};

export const ShowsTheEndOfThePassForAnEmptyQueue: Story = {
  beforeEach({ msw }) {
    msw.use(getGetCleanupQueueMockHandler200(() => []));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("cleanup-review-empty"),
    ).toHaveTextContent("No suggestions pending.");
    await expect(canvas.queryByTestId("cleanup-tally")).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("cleanup-progress"),
    ).not.toBeInTheDocument();
  },
};

export const TypingOverATitleMarksItEditedAndAcceptsTheNewWording: Story =
  renaming(async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await expect(canvas.queryByTestId("cleanup-edited-tag")).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Accept (Y)" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cleanup-decide-note")).toHaveTextContent(
      "accepting applies at once · you can undo it",
    );

    await userEvent.type(input, "; or, The Modern Prometheus");

    await expect(canvas.getByTestId("cleanup-edited-tag")).toHaveTextContent(
      "edited",
    );
    await expect(canvas.getByTestId("cleanup-decide-note")).toHaveTextContent(
      "your wording replaces the proposal",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Accept edited title (Y)" }),
    );

    await canvas.findByDisplayValue("Emma");
    await expect(decided).toEqual([
      {
        id: 11,
        request: {
          decision: "accepted",
          value: "Frankenstein; or, The Modern Prometheus",
        },
      },
    ]);
    await expect(canvas.getByTestId("cleanup-undo-bar")).toHaveTextContent(
      "Renamed to “Frankenstein; or, The Modern Prometheus”.",
    );
  });

export const RestoringTheProposalDropsTheEditedMark: Story = renaming(
  async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await userEvent.type(input, "!");
    await expect(canvas.getByTestId("cleanup-edited-tag")).toBeVisible();

    await userEvent.type(input, "{Backspace}");

    await expect(canvas.queryByTestId("cleanup-edited-tag")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));
    await canvas.findByDisplayValue("Emma");
    await expect(decided).toEqual([
      { id: 11, request: { decision: "accepted" } },
    ]);
  },
);

export const TheDraftStartsOverOnTheNextCard: Story = renaming(
  async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", {
      name: "Proposed title",
    });
    await userEvent.type(input, " (edited)");

    await userEvent.click(canvas.getByRole("button", { name: "Skip (Space)" }));

    await expect(await canvas.findByDisplayValue("Emma")).toBeInTheDocument();
    await expect(canvas.queryByTestId("cleanup-edited-tag")).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Accept (Y)" }),
    ).toBeInTheDocument();
  },
);

export const ListsOnlyWhatThePassDidAtTheEnd: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("cleanup-card");
    await userEvent.click(canvas.getByRole("button", { name: "Accept (Y)" }));
    await canvas.findByText("Split this tag into its parts.");
    await userEvent.click(canvas.getByRole("button", { name: "Reject (N)" }));
    await canvas.findByText("Merge these tags into one.");
    await userEvent.click(canvas.getByRole("button", { name: "Skip (Space)" }));

    const tally = await canvas.findByTestId("cleanup-tally");
    await expect(
      within(tally)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      "1accepted as proposed",
      "1rejected",
      "1skipped — comes back next pass",
    ]);
    await expect(
      canvas.getByText("No suggestions pending."),
    ).toBeInTheDocument();
  },
};

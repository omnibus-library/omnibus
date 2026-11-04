import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { bookHandler, deferred, failing } from "../../testing/handlers";
import {
  aWireRequest,
  aWireVersion,
  requestFake,
} from "../../testing/requestHandlers";
import { aWireBook, WIRE_ADA } from "../../testing/wire";
import { BookRequest } from "./BookRequest";

const UUID = "uuid-hyperion";
const BOOK = aWireBook({
  title: "Hyperion",
  unique_identifier: UUID,
  creators: [{ name: "Dan Simmons", role: null, file_as: null, id: 3 }],
  formats: [],
});

const EPUB = aWireVersion({ id: 11, best_match: true });
const PDF = aWireVersion({
  id: 12,
  title: "Simmons, Dan - Hyperion (retail).pdf",
  size_bytes: 9_100_000,
  format: "PDF",
  indexer: "Library Ink",
});
const UNNAMED = aWireVersion({
  id: 13,
  title: "Hyperion by Dan Simmons",
  size_bytes: null,
  format: null,
  indexer: null,
});

let fake = requestFake();
let held = deferred();

/** The version row at `index`. */
function versionAt(rows: HTMLElement[], index: number) {
  const row = rows[index];
  if (!row) throw new Error(`no version row at ${index}`);
  return row;
}

function Page() {
  return (
    <Routes>
      <Route path="/books/:uuid/request" element={<BookRequest />} />
      <Route path="/books/:uuid" element={<h1>Book page</h1>} />
    </Routes>
  );
}

const READER = { ...WIRE_ADA, is_admin: false, can_request: true };

const meta = {
  title: "Pages/BookRequest",
  component: Page,
  parameters: { path: `/books/${UUID}/request?id=7` },
  beforeEach({ msw }) {
    fake = requestFake([aWireRequest()]);
    msw.use(bookHandler(BOOK), ...fake.handlers);
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

// Handlers listed first win in one `msw.use`, so a story that overrides a route puts it before these.
const seed = (request: Parameters<typeof aWireRequest>[0]) => {
  fake = requestFake([aWireRequest(request)]);
  return [bookHandler(BOOK), ...fake.handlers];
};

export const Looking: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Hyperion" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Dan Simmons")).toBeInTheDocument();
    await expect(canvas.getByTestId("request-state")).toHaveTextContent(
      "Looking",
    );
    const waiting = canvas.getByTestId("request-looking");
    await expect(waiting).toHaveAttribute("role", "status");
    await expect(waiting).toHaveTextContent("Looking for versions");
    await expect(canvas.queryByTestId("request-version")).toBeNull();
  },
};

let reads = 0;

export const LookingBecomesChooseAVersionWhenTheSearchFinishes: Story = {
  beforeEach({ msw }) {
    reads = 0;
    msw.use(
      http.get("/api/requests/:id", () => {
        reads += 1;
        return HttpResponse.json(
          reads < 2
            ? aWireRequest()
            : aWireRequest({ state: "choose", versions: [EPUB] }),
        );
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-looking"),
    ).toBeInTheDocument();

    await waitFor(
      () =>
        expect(canvas.getByTestId("request-state")).toHaveTextContent(
          "Choose a version",
        ),
      { timeout: 4000 },
    );
    await expect(canvas.queryByTestId("request-looking")).toBeNull();
    await expect(canvas.getAllByTestId("request-version")).toHaveLength(1);
  },
};

export const ChooseAVersionListsEachVersionWithOneBestMatch: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, PDF, UNNAMED] }));
  },
  play: async ({ canvas }) => {
    const rows = await canvas.findAllByTestId("request-version");

    await expect(rows).toHaveLength(3);
    await expect(versionAt(rows, 0)).toHaveTextContent("EPUB");
    await expect(versionAt(rows, 0)).toHaveTextContent("2.4 MB");
    await expect(versionAt(rows, 1)).toHaveTextContent("PDF");
    await expect(versionAt(rows, 2)).toHaveTextContent("Unknown");
    await expect(versionAt(rows, 2)).toHaveTextContent("Size unknown");
    await expect(canvas.getAllByTestId("request-best-match")).toHaveLength(1);
    await expect(
      within(versionAt(rows, 0)).getByTestId("request-best-match"),
    ).toHaveTextContent("Best match");
  },
};

export const DetailsRevealWhereAVersionCameFromAndWhatItIsCalled: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [PDF] }));
  },
  play: async ({ canvas, userEvent }) => {
    const row = within(await canvas.findByTestId("request-version"));
    await expect(row.queryByTestId("request-details")).toBeNull();
    const toggle = row.getByTestId("request-details-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = row.getByTestId("request-details");
    await expect(details).toHaveTextContent("Library Ink");
    await expect(details).toHaveTextContent(
      "Simmons, Dan - Hyperion (retail).pdf",
    );
    await userEvent.click(toggle);
    await expect(row.queryByTestId("request-details")).toBeNull();
  },
};

export const ChoosingAVersionSendsItsIdAndConfirmsThePick: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, PDF] }));
  },
  play: async ({ canvas, userEvent }) => {
    const rows = await canvas.findAllByTestId("request-version");

    await userEvent.click(
      within(versionAt(rows, 1)).getByTestId("request-choose"),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent(
        "Version chosen",
      ),
    );
    await expect(fake.writes).toEqual([
      { kind: "choose", id: 7, resultId: 12 },
    ]);
    await expect(canvas.getByTestId("request-chosen")).toHaveTextContent("PDF");
    await expect(canvas.getByText("We’ll fetch it next.")).toBeVisible();
    await expect(canvas.queryByTestId("request-choose")).toBeNull();
  },
};

export const AFailedChoiceTellsYouAndKeepsTheVersions: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("post", "/api/requests/:id/choose", 409),
      ...seed({ state: "choose", versions: [EPUB] }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("request-choose"));

    await expect(
      await canvas.findByText(/Couldn’t choose that version/),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("request-choose")).toBeEnabled();
  },
};

export const ChosenShowsThePick: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...seed({
        state: "chosen",
        chosen_result_id: 11,
        versions: [EPUB, PDF],
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("request-chosen")).toHaveTextContent(
      "EPUB, 2.4 MB",
    );
    await expect(canvas.getByTestId("request-state")).toHaveTextContent(
      "Version chosen",
    );
    await expect(canvas.queryByTestId("request-version")).toBeNull();
  },
};

const STUCK = {
  state: "stuck",
  stuck_reason: "not_found",
  stuck_detail: "indexer 3 disabled until 2030-01-01T00:00:00Z",
} as const;

export const StuckSaysCouldntFindItAndOffersTryAgain: Story = {
  parameters: { user: READER },
  beforeEach({ msw }) {
    msw.use(...seed({ ...STUCK, stuck_detail: null }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("request-state")).toHaveTextContent(
      "Couldn’t find it",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeEnabled();
  },
};

export const StuckShowsWhatWentWrongWhenTheServerSendsIt: Story = {
  beforeEach({ msw }) {
    msw.use(...seed(STUCK));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-stuck-detail"),
    ).toHaveTextContent("indexer 3 disabled until 2030-01-01T00:00:00Z");
  },
};

export const TryAgainSearchesAgainAndReturnsToLooking: Story = {
  beforeEach({ msw }) {
    msw.use(...seed(STUCK));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("request-try-again"));

    await expect(
      await canvas.findByTestId("request-looking"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("request-state")).toHaveTextContent(
      "Looking",
    );
    await expect(
      canvas.getByRole("heading", { level: 2, name: "Ebook" }),
    ).toHaveFocus();
    await expect(fake.writes).toEqual([{ kind: "retry", id: 7 }]);
  },
};

export const AFailedTryAgainTellsYou: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/requests/:id/retry", 429), ...seed(STUCK));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("request-try-again"));

    await expect(
      await canvas.findByText(/Couldn’t try again/),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("request-state")).toHaveTextContent(
      "Couldn’t find it",
    );
  },
};

const DOWNLOADING: Parameters<typeof aWireRequest>[0] = {
  state: "on_its_way",
  chosen_result_id: 11,
  progress: 0.426,
  versions: [EPUB, PDF],
};

export const OnItsWayShowsOneProgressBarWithCancelAndPickAnother: Story = {
  beforeEach({ msw }) {
    msw.use(...seed(DOWNLOADING));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("request-state")).toHaveTextContent(
      "On its way",
    );
    const bar = canvas.getByRole("progressbar", { name: "Download progress" });
    await expect(bar).toHaveAttribute("value", "42");
    await expect(canvas.getByTestId("request-percent")).toHaveTextContent(
      "42%",
    );
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Pick another" }),
    ).toBeEnabled();
  },
};

export const TheBarFollowsTheDownloadAsItIsPolled: Story = {
  beforeEach({ msw }) {
    reads = 0;
    msw.use(
      http.get("/api/requests/:id", () => {
        reads += 1;
        const progress = reads < 2 ? 0.2 : 0.6;
        return HttpResponse.json(aWireRequest({ ...DOWNLOADING, progress }));
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-percent"),
    ).toHaveTextContent("20%");

    await waitFor(
      () =>
        expect(canvas.getByTestId("request-percent")).toHaveTextContent("60%"),
      { timeout: 4000 },
    );
  },
};

export const ABarBeforeTheClientReportsHasNoValueAndNoPercent: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ ...DOWNLOADING, progress: null }));
  },
  play: async ({ canvas }) => {
    const bar = await canvas.findByRole("progressbar", {
      name: "Download progress",
    });

    await expect(bar).not.toHaveAttribute("value");
    await expect(canvas.queryByTestId("request-percent")).toBeNull();
  },
};

export const CancelAndPickAnotherLockTogetherWhileOneIsPending: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      http.post("/api/requests/:id/cancel", async () => {
        await held.promise;
        return HttpResponse.json(
          aWireRequest({ ...DOWNLOADING, state: "cancelled" }),
        );
      }),
      ...seed(DOWNLOADING),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Cancel" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("request-pick-another")).toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    await userEvent.click(canvas.getByTestId("request-pick-another"));
    await expect(fake.writes).toEqual([]);
    held.release();
  },
};

export const AFinishedDownloadOffersNeitherCancelNorPickAnother: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ ...DOWNLOADING, progress: 1 }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Adding it to the library…"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("request-percent")).toBeNull();

    await expect(canvas.queryByRole("button", { name: "Cancel" })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Pick another" }),
    ).toBeNull();
  },
};

export const CancellingShowsCancelledAtOnceWithAnUndoThatPutsItBack: Story = {
  beforeEach({ msw }) {
    msw.use(...seed(DOWNLOADING));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Cancel" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent(
        "Cancelled",
      ),
    );
    await expect(canvas.queryByTestId("request-downloading")).toBeNull();
    await userEvent.click(await canvas.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent(
        "On its way",
      ),
    );
    await waitFor(() =>
      expect(canvas.getByRole("heading", { name: "Ebook" })).toHaveFocus(),
    );
    await expect(fake.writes).toEqual([
      { kind: "cancel", id: 7 },
      { kind: "undo", id: 7 },
    ]);
  },
};

export const AFailedCancelTellsYouAndKeepsTheDownload: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("post", "/api/requests/:id/cancel", 409),
      ...seed(DOWNLOADING),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Cancel" }),
    );

    await expect(
      await canvas.findByText(/Couldn’t cancel/),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("request-state")).toHaveTextContent(
      "On its way",
    );
  },
};

export const PickAnotherGoesBackToTheVersionsWithThePickedOneMarkedDidntWork: Story =
  {
    beforeEach({ msw }) {
      msw.use(...seed(DOWNLOADING));
    },
    play: async ({ canvas, userEvent }) => {
      await userEvent.click(
        await canvas.findByRole("button", { name: "Pick another" }),
      );

      await waitFor(() =>
        expect(canvas.getByTestId("request-state")).toHaveTextContent(
          "Choose a version",
        ),
      );
      await expect(canvas.getByTestId("request-note")).toHaveTextContent(
        "Swapped for another version",
      );
      const rows = canvas.getAllByTestId("request-version");
      await expect(rows).toHaveLength(2);
      await expect(rows[0]).toHaveFocus();
      await expect(
        within(versionAt(rows, 0)).getByText("PDF"),
      ).toBeInTheDocument();
      await expect(
        within(versionAt(rows, 1)).getByTestId("request-didnt-work"),
      ).toHaveTextContent("Didn’t work");
      await expect(
        within(versionAt(rows, 1)).queryByTestId("request-choose"),
      ).toBeNull();
      await expect(fake.writes).toEqual([{ kind: "swap", id: 7 }]);
    },
  };

const STOPPED: Parameters<typeof aWireRequest>[0] = {
  state: "stuck",
  stuck_reason: "stopped_moving",
  chosen_result_id: 11,
  versions: [EPUB, PDF],
};

export const StoppedMovingNamesItAndTryAgainOffersTheOtherVersions: Story = {
  beforeEach({ msw }) {
    msw.use(...seed(STOPPED));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByTestId("request-state")).toHaveTextContent(
      "Stopped moving",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent(
        "Choose a version",
      ),
    );
    await expect(canvas.getAllByTestId("request-version")).toHaveLength(2);
    await expect(canvas.getByTestId("request-didnt-work")).toBeInTheDocument();
    await expect(canvas.getAllByTestId("request-choose")).toHaveLength(1);
    await expect(fake.writes).toEqual([{ kind: "retry", id: 7 }]);
  },
};

export const ReadyToRead: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "ready", chosen_result_id: 11, progress: 1 }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("request-state")).toHaveTextContent(
      "Ready to read",
    );
    await expect(canvas.getByText("It’s in the library.")).toBeInTheDocument();
    await expect(canvas.queryByTestId("request-downloading")).toBeNull();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

const COULDNT_ADD: Parameters<typeof aWireRequest>[0] = {
  state: "stuck",
  stuck_reason: "couldnt_add",
  chosen_result_id: 11,
  progress: 1,
};

export const CouldntAddItNamesItAndOffersTryAgain: Story = {
  parameters: { user: READER },
  beforeEach({ msw }) {
    msw.use(...seed(COULDNT_ADD));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("request-state")).toHaveTextContent(
      "Couldn’t add it",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeEnabled();
  },
};

export const CouldntAddItShowsAnAdminWhatWentWrong: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...seed({
        ...COULDNT_ADD,
        stuck_detail: "filing the download failed: permission denied",
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-stuck-detail"),
    ).toHaveTextContent("filing the download failed: permission denied");
  },
};

export const TheBookLinkGoesBackToTheBookPage: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("link", { name: "Back to book" }),
    );

    await expect(
      await canvas.findByRole("heading", { name: "Book page" }),
    ).toBeInTheDocument();
  },
};

export const AnUnknownRequestShowsTheErrorWithAWayBack: Story = {
  parameters: { path: `/books/${UUID}/request?id=99` },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Back to book" }),
    ).toHaveAttribute("href", `/books/${UUID}`);
  },
};

const OLD = Math.floor(Date.now() / 1000) - 120;
const NOT_THE_MAKER = { ...WIRE_ADA, id: 2, is_admin: false };

export const ALongRunningSearchOffersTryAgain: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ updated_at: OLD }));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByTestId("request-still-looking"),
    ).toHaveTextContent("Still looking…");

    await userEvent.click(canvas.getByTestId("request-try-again"));

    await waitFor(() =>
      expect(fake.writes).toEqual([{ kind: "retry", id: 7 }]),
    );
  },
};

export const AFreshSearchOffersNoTryAgain: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-looking");

    await expect(canvas.queryByTestId("request-try-again")).toBeNull();
    await expect(canvas.queryByTestId("request-still-looking")).toBeNull();
  },
};

export const AnotherReadersChoiceCanBeReadButNotMade: Story = {
  parameters: { user: NOT_THE_MAKER },
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, PDF] }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByTestId("request-version")).toHaveLength(
      2,
    );

    await expect(canvas.queryByTestId("request-choose")).toBeNull();
    await expect(canvas.getAllByTestId("request-details-toggle")).toHaveLength(
      2,
    );
  },
};

export const AnotherReadersStuckRequestOffersNoTryAgain: Story = {
  parameters: { user: NOT_THE_MAKER },
  beforeEach({ msw }) {
    msw.use(...seed(STUCK));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-stuck-detail");

    await expect(canvas.queryByTestId("request-try-again")).toBeNull();
  },
};

export const AdminMayActOnAnotherReadersRequest: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ user_id: 9, state: "choose", versions: [EPUB] }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("request-choose")).toBeEnabled();
  },
};

export const ChoosingMarksOnlyTheChosenRowBusy: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      http.post("/api/requests/:id/choose", async () => {
        await held.promise;
        return HttpResponse.json(
          aWireRequest({
            state: "chosen",
            chosen_result_id: 12,
            versions: [EPUB, PDF],
          }),
        );
      }),
      ...seed({ state: "choose", versions: [EPUB, PDF] }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const rows = await canvas.findAllByTestId("request-version");
    const [first, second] = [versionAt(rows, 0), versionAt(rows, 1)];

    await userEvent.click(within(second).getByTestId("request-choose"));

    await waitFor(() =>
      expect(within(second).getByTestId("request-choose")).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    await expect(within(first).getByTestId("request-choose")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(within(first).getByTestId("request-choose")).toBeDisabled();
    held.release();
    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent(
        "Version chosen",
      ),
    );
  },
};

export const AnOldUuidInTheAddressMovesToTheBooksCurrentOne: Story = {
  parameters: { path: "/books/old-uuid/request?id=7" },
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/ebooks/:uuid", () => HttpResponse.json(BOOK)),
      ...seed({}),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Back to book" }),
    ).toHaveAttribute("href", `/books/${UUID}`);
  },
};

export const AnotherReadersDownloadOffersNoCancelOrPickAnother: Story = {
  parameters: { user: NOT_THE_MAKER },
  beforeEach({ msw }) {
    msw.use(...seed(DOWNLOADING));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-downloading");

    await expect(canvas.queryByRole("button", { name: "Cancel" })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Pick another" }),
    ).toBeNull();
  },
};

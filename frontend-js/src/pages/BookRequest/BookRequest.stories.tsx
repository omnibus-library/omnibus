import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { bookHandler, deferred, failing } from "../../testing/handlers";
import {
  aWireListing,
  aWireRequest,
  aWireVersion,
  HYPERION,
  requestFake,
} from "../../testing/requestHandlers";
import { WIRE_ADA } from "../../testing/wire";
import { BookRequest } from "./BookRequest";

const UUID = HYPERION.unique_identifier;

const EPUB = aWireVersion({ id: 11, best_match: true });
const PDF = aWireVersion({
  id: 12,
  title: "Simmons, Dan - Hyperion (retail).pdf",
  size_bytes: 9_100_000,
  format: "PDF",
  indexer: "Library Ink",
  seeders: 1,
});
const UNNAMED = aWireVersion({
  id: 13,
  title: "Hyperion by Dan Simmons",
  size_bytes: null,
  format: null,
  indexer: null,
  seeders: null,
});

let fake = requestFake();

/** No book on anyone's wishlist, unless a story says otherwise. */
const NOBODY_WISHES = http.get("/api/wishlists", () => HttpResponse.json([]));
let held = deferred();

/** The version row at `index`. */
function versionAt(rows: HTMLElement[], index: number) {
  const row = rows[index];
  if (!row) throw new Error(`no version row at ${index}`);
  return row;
}

/** Where the router is, so a story can see the page move to another request. */
function Where() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="where">
      {pathname}
      {search}
    </output>
  );
}

function Page() {
  return (
    <>
      <Routes>
        <Route path="/books/:uuid/request" element={<BookRequest />} />
        <Route path="/books/:uuid" element={<h1>Book page</h1>} />
      </Routes>
      <Where />
    </>
  );
}

const READER = { ...WIRE_ADA, is_admin: false, can_request: true };

const meta = {
  title: "Pages/BookRequest",
  component: Page,
  parameters: { path: `/books/${UUID}/request?id=7` },
  beforeEach({ msw }) {
    fake = requestFake([aWireRequest()]);
    msw.use(bookHandler(HYPERION), ...fake.handlers, NOBODY_WISHES);
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

// Handlers listed first win in one `msw.use`, so a story that overrides a route puts it before these.
const seed = (request: Parameters<typeof aWireRequest>[0]) => {
  fake = requestFake([aWireRequest(request)]);
  return [bookHandler(HYPERION), ...fake.handlers];
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

export const AVersionRowNamesTheReleaseAndItsSource: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, PDF] }));
  },
  play: async ({ canvas }) => {
    const rows = await canvas.findAllByTestId("request-version");
    const epub = within(versionAt(rows, 0));

    await expect(epub.getByTestId("request-version-name")).toHaveTextContent(
      "Hyperion - Dan Simmons EPUB",
    );
    await expect(epub.getByTestId("request-version-meta")).toHaveTextContent(
      "Books · EPUB · 2.4 MB · 12 seeders",
    );
    await expect(
      within(versionAt(rows, 1)).getByTestId("request-version-meta"),
    ).toHaveTextContent("Library Ink · PDF · 9.1 MB · 1 seeder");
    await expect(
      epub.getByRole("button", {
        name: "Choose the EPUB version from Books, 2.4 MB",
      }),
    ).toBeVisible();
  },
};

export const AVersionRowLeavesOutAnUnnamedSourceAndMissingSeeders: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [UNNAMED] }));
  },
  play: async ({ canvas }) => {
    const row = within(await canvas.findByTestId("request-version"));

    await expect(row.getByTestId("request-version-name")).toHaveTextContent(
      "Hyperion by Dan Simmons",
    );
    await expect(row.getByTestId("request-version-meta")).toHaveTextContent(
      "Unknown · Size unknown",
    );
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
    await expect(
      canvas.getByRole("listitem", { current: "step" }),
    ).toHaveTextContent("On its way");
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

export const OnItsWayShowsOneProgressBarWithCancelAndChooseAnother: Story = {
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
      canvas.getByRole("button", { name: "Choose another" }),
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

export const CancelAndChooseAnotherLockTogetherWhileOneIsPending: Story = {
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

export const AFinishedDownloadOffersNeitherCancelNorChooseAnother: Story = {
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
      canvas.queryByRole("button", { name: "Choose another" }),
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
    // The toast's Undo takes the keyboard's focus from the Cancel that is gone.
    await expect(canvas.getByRole("button", { name: "Undo" })).toHaveFocus();
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
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

export const ChooseAnotherGoesBackToTheVersionsWithThePickedOneMarkedDidntWork: Story =
  {
    beforeEach({ msw }) {
      msw.use(...seed(DOWNLOADING));
    },
    play: async ({ canvas, userEvent }) => {
      await userEvent.click(
        await canvas.findByRole("button", { name: "Choose another" }),
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
    await expect(
      canvas.getAllByRole("listitem").map((step) => step.dataset.status),
    ).toEqual(["done", "done", "done", "done"]);
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

export const OpenBookPageGoesToTheBookPage: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("link", { name: "Open book page" }),
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
      http.get("/api/ebooks/:uuid", () => HttpResponse.json(HYPERION)),
      ...seed({}),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Open book page" }),
    ).toHaveAttribute("href", `/books/${UUID}`);
  },
};

export const AnotherReadersDownloadOffersNoCancelOrChooseAnother: Story = {
  parameters: { user: NOT_THE_MAKER },
  beforeEach({ msw }) {
    msw.use(...seed(DOWNLOADING));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-downloading");

    await expect(canvas.queryByRole("button", { name: "Cancel" })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Choose another" }),
    ).toBeNull();
  },
};

// ---- the stepper, the download card, the byline ----

export const TheStepperMarksWhereTheRequestStands: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, PDF] }));
  },
  play: async ({ canvas }) => {
    const steps = within(
      await canvas.findByRole("list", { name: "Progress of this request" }),
    ).getAllByRole("listitem");

    await expect(steps.map((step) => step.textContent)).toEqual([
      "Looking · 2 found",
      "Choose a version",
      "On its way",
      "Ready",
    ]);
    await expect(steps.map((step) => step.dataset.status)).toEqual([
      "done",
      "current",
      "todo",
      "todo",
    ]);
    await expect(steps[1]).toHaveAttribute("aria-current", "step");
  },
};

export const ALaneWaitingOnYourPickIsMarked: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB] }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-lane-ebook"),
    ).toHaveAttribute("data-needs-you", "true");
  },
};

export const AnotherReadersPickIsNotMarkedAsYours: Story = {
  parameters: { user: NOT_THE_MAKER },
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB] }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-lane-ebook"),
    ).toHaveAttribute("data-needs-you", "false");
  },
};

export const ADownloadShowsTheReleaseItsSourceAndTimeLeft: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...seed({
        ...DOWNLOADING,
        expected_done_at: Math.floor(Date.now() / 1000) + 180,
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-picked-name"),
    ).toHaveTextContent(EPUB.title);
    await expect(canvas.getByTestId("request-download-meta")).toHaveTextContent(
      "2.4 MB · Books · about 3 min left",
    );
  },
};

export const ADownloadWithNoTimeFromTheClientLeavesItOut: Story = {
  beforeEach({ msw }) {
    msw.use(...seed(DOWNLOADING));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-download-meta"),
    ).toHaveTextContent(/^2\.4 MB · Books$/);
  },
};

export const TheBylineNamesWhoseWishlistsHoldTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/wishlists", () =>
        HttpResponse.json([
          {
            book: HYPERION,
            added_at: 0,
            wanted_by: [
              { id: 2, name: "Jordan" },
              { id: 3, name: "Riley" },
            ],
            holdings: [],
          },
        ]),
      ),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("request-byline")).toHaveTextContent(
        "Dan Simmons · On Jordan’s and Riley’s wishlists",
      ),
    );
  },
};

export const TheBylineIsTheAuthorAloneWhenNobodyWishesForIt: Story = {
  beforeEach({ msw }) {
    msw.use(http.get("/api/wishlists", () => HttpResponse.json([])));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("request-byline")).toHaveTextContent(
      /^Dan Simmons$/,
    );
  },
};

// ---- who asked, and another reader's lane ----

const GRACE = { 1: "Ada Lovelace", 2: "Grace Hopper" };

export const TheLaneNamesWhoAskedAndWhen: Story = {
  parameters: { user: { ...WIRE_ADA, id: 3 } },
  beforeEach({ msw }) {
    fake = requestFake([aWireRequest({ user_id: 2 })], { names: GRACE });
    msw.use(bookHandler(HYPERION), ...fake.handlers);
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-requester"),
    ).toHaveTextContent("· requested by GH Grace Hopper · just now");
  },
};

export const TheLaneCallsYourOwnRequestYours: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("request-requester"),
    ).toHaveTextContent("· requested by AL You · just now");
  },
};

export const AnAdminsCancelNamesWhoseRequestItIs: Story = {
  beforeEach({ msw }) {
    fake = requestFake([aWireRequest({ user_id: 2 })], { names: GRACE });
    msw.use(bookHandler(HYPERION), ...fake.handlers);
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", {
        name: "Cancel Grace Hopper’s request for Hyperion",
      }),
    ).toBeInTheDocument();
  },
};

export const AnotherReadersLiveRequestGetsALaneOfItsOwn: Story = {
  beforeEach({ msw }) {
    fake = requestFake(
      [
        aWireRequest(),
        aWireRequest({ id: 8, user_id: 2, state: "choose", versions: [EPUB] }),
      ],
      { names: GRACE },
    );
    msw.use(bookHandler(HYPERION), ...fake.handlers);
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getAllByTestId("request-state")).toHaveLength(2),
    );
    const [mine, theirs] = canvas.getAllByTestId("request-lane-ebook");

    await expect(mine).toHaveTextContent("Looking");
    await expect(theirs).toHaveTextContent("Grace Hopper");
    await expect(theirs).toHaveTextContent("Choose a version");
  },
};

// ---- the book's history: its other requests ----

const OCT_12 = Date.UTC(2026, 9, 12, 12) / 1000;

const CANCELLED_EARLIER = aWireRequest({
  id: 5,
  state: "cancelled",
  cancelled_by: 1,
  chosen_result_id: EPUB.id,
  progress: 0.4,
  versions: [EPUB],
  updated_at: OCT_12,
});

/** The request on screen, `shown`, and the book's earlier ones. */
const withHistory = (
  shown: Parameters<typeof aWireRequest>[0],
  ...earlier: Parameters<typeof aWireRequest>[0][]
) => {
  fake = requestFake([aWireRequest(shown), ...earlier.map(aWireRequest)]);
  return [bookHandler(HYPERION), ...fake.handlers];
};

const CANCELLED_NOW = { state: "cancelled", cancelled_by: 1 } as const;

export const HistoryRecordsACancelledRequestOnTheDayItEnded: Story = {
  beforeEach({ msw }) {
    msw.use(...withHistory({}, CANCELLED_EARLIER));
  },
  play: async ({ canvas }) => {
    const history = within(await canvas.findByTestId("request-history"));
    // One row: the request on screen is not its own history.
    const row = await history.findByTestId("request-history-row");

    await expect(row).toHaveTextContent(
      "Cancelled by you · EPUB · 2.4 MB · stopped at 40%",
    );
    await expect(
      within(row).getByTestId("request-history-day"),
    ).toHaveTextContent("Oct 12");
  },
};

export const RequestAgainFromHistoryStartsANewRequestInLooking: Story = {
  parameters: { user: READER },
  beforeEach({ msw }) {
    msw.use(...withHistory(CANCELLED_NOW, CANCELLED_EARLIER));
  },
  play: async ({ canvas, userEvent }) => {
    const history = within(await canvas.findByTestId("request-history"));

    await userEvent.click(
      await history.findByRole("button", { name: "Request again" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        `/books/${UUID}/request?id=8`,
      ),
    );
    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent("Looking"),
    );
    await expect(fake.writes).toEqual([{ kind: "start", uuid: UUID }]);
  },
};

export const RequestAgainWaitsForTheUndoToRunOut: Story = {
  parameters: { user: READER },
  beforeEach({ msw }) {
    msw.use(
      ...withHistory({
        ...CANCELLED_NOW,
        cancel_at: Math.floor(Date.now() / 1000) + 600,
      }),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent(
        "Cancelled",
      ),
    );

    await expect(
      canvas.queryByRole("button", { name: "Request again" }),
    ).toBeNull();
  },
};

export const RequestAgainIsNotOfferedBesideYourLiveRequest: Story = {
  parameters: { user: READER },
  beforeEach({ msw }) {
    msw.use(...withHistory({}, CANCELLED_EARLIER));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-history-row");

    await expect(
      canvas.queryByRole("button", { name: "Request again" }),
    ).toBeNull();
  },
};

export const HistoryRecordsAVersionSwappedForAnother: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...withHistory(
        {},
        {
          id: 5,
          state: "stuck",
          stuck_reason: "stopped_moving",
          chosen_result_id: EPUB.id,
          progress: 0.25,
          versions: [EPUB, { ...PDF, rejected: true }],
        },
      ),
    );
  },
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("request-history-row");

    await expect(row).toHaveTextContent(
      "Stopped moving · EPUB · 2.4 MB · stopped at 25%",
    );
    await expect(row).toHaveTextContent(
      "Swapped for another version · PDF · 9.1 MB",
    );
    await expect(
      within(row).queryByRole("button", { name: "Request again" }),
    ).toBeNull();
  },
};

export const HistoryOffersNoRequestAgainToAReaderWhoCantRequest: Story = {
  parameters: { user: { ...READER, can_request: false } },
  beforeEach({ msw }) {
    msw.use(...withHistory(CANCELLED_NOW, CANCELLED_EARLIER));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-history-row");

    await expect(
      canvas.queryByRole("button", { name: "Request again" }),
    ).toBeNull();
  },
};

export const ABookWithNoOtherRequestShowsNoHistory: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-looking");

    await waitFor(() =>
      expect(canvas.queryByTestId("request-history")).toBeNull(),
    );
  },
};

export const AFailedHistoryReadOffersTryAgain: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/books/:uuid/requests", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t read this book’s request history.",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  },
};

let historyReads = 0;

export const AFailedHistoryRereadKeepsTheRowsShown: Story = {
  beforeEach({ msw }) {
    historyReads = 0;
    msw.use(
      http.get("/api/books/:uuid/requests", () => {
        historyReads += 1;
        return historyReads === 1
          ? HttpResponse.json([
              aWireListing({ request: aWireRequest({ ...DOWNLOADING }) }),
              aWireListing({ request: CANCELLED_EARLIER }),
            ])
          : new HttpResponse("down", { status: 500 });
      }),
      ...withHistory(DOWNLOADING, CANCELLED_EARLIER),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("request-history-row");

    // A cancel has the lists read again; this read fails.
    await userEvent.click(
      await canvas.findByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => expect(historyReads).toBeGreaterThan(1));
    await expect(canvas.getByTestId("request-history-row")).toBeInTheDocument();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const ACancelledRequestOffersRequestAgain: Story = {
  parameters: { user: READER },
  beforeEach({ msw }) {
    msw.use(...seed(CANCELLED_NOW));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Request again" }),
    );

    await waitFor(() =>
      expect(fake.writes).toEqual([{ kind: "start", uuid: UUID }]),
    );
  },
};

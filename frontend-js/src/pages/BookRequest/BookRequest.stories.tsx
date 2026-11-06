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
import { Requests } from "../Requests/Requests";
import { PHONE } from "../Wishlists/Wishlists.stories.shared";

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
const REVISED = aWireVersion({
  id: 14,
  title: "Hyperion - Dan Simmons EPUB [Gollancz, corrected contents v2]",
  seeders: 37,
});
const USENET = aWireVersion({
  id: 17,
  title: "Dan Simmons - Hyperion.epub",
  size_bytes: 2_100_000,
  indexer: "NZBgeek",
  seeders: null,
  protocol: "usenet",
});
const SCENE = aWireVersion({
  id: 15,
  title: "Hyperion.1989.EPUB-BOOKS",
  size_bytes: 1_600_000,
  indexer: "Library Ink",
  seeders: 4,
});
const TRIED = aWireVersion({
  id: 16,
  title: "Hyperion (1989) [EPUB]",
  size_bytes: 1_900_000,
  indexer: "Library Ink",
  seeders: 0,
  rejected: true,
});
/** Six that can be chosen and one that was tried, in the server's order. */
const MANY = [EPUB, REVISED, USENET, SCENE, PDF, UNNAMED, TRIED];
const NBSP = "\u00a0";
const SEP = `${NBSP}· `;

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
        <Route path="/requests" element={<Requests />} />
        <Route path="/books/:uuid" element={<h1>Book page</h1>} />
      </Routes>
      <Where />
    </>
  );
}

// `book_requests` is on, or `Requests` answers Not Found.
const ADA = { ...WIRE_ADA, book_requests: true };
const READER = { ...ADA, is_admin: false, can_request: true };

const meta = {
  title: "Pages/BookRequest",
  component: Page,
  parameters: { path: `/requests?book=${UUID}`, user: ADA },
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
      await canvas.findByRole("heading", { level: 2, name: "Hyperion" }),
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
    msw.use(...seed({ state: "choose", versions: MANY }));
  },
  play: async ({ canvas }) => {
    const rows = await canvas.findAllByTestId("request-version");

    await expect(rows).toHaveLength(5);
    await expect(canvas.getAllByTestId("request-best-match")).toHaveLength(1);
    await expect(
      within(versionAt(rows, 0)).getByTestId("request-best-match"),
    ).toHaveTextContent("Best match");
  },
};

export const TheVersionsFoundAreCountedAboveTheList: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: MANY }));
  },
  play: async ({ canvas }) => {
    const caption = await canvas.findByTestId("request-versions-found");

    await expect(caption.textContent).toBe(
      "6 versions found · Best match first",
    );
  },
};

export const ShowMoreRevealsTheVersionsPastTheFirstFour: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: MANY }));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findAllByTestId("request-version")).toHaveLength(
      5,
    );
    const more = canvas.getByRole("button", { name: "Show 2 more" });
    await expect(more).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(more);

    await expect(canvas.getAllByTestId("request-version")).toHaveLength(7);
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(more).toHaveFocus();
    await expect(more).toHaveTextContent("Show fewer");

    await userEvent.click(more);

    await expect(canvas.getAllByTestId("request-version")).toHaveLength(5);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toHaveTextContent("Show 2 more");
  },
};

export const AVersionRowNamesTheReleaseAndItsSource: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, PDF] }));
  },
  play: async ({ canvas }) => {
    const rows = await canvas.findAllByTestId("request-version");
    const epub = within(versionAt(rows, 0));

    await expect(epub.getByTestId("request-version-name").textContent).toBe(
      "Hyperion - Dan Simmons EPUB",
    );
    await expect(epub.getByTestId("request-version-meta").textContent).toBe(
      `Books${SEP}EPUB${SEP}2.4${NBSP}MB${SEP}12${NBSP}seeds`,
    );
    await expect(
      within(versionAt(rows, 1)).getByTestId("request-version-meta")
        .textContent,
    ).toBe(`Library Ink${SEP}PDF${SEP}9.1${NBSP}MB${SEP}1${NBSP}seed`);
  },
};

export const AUsenetVersionSaysUsenetInPlaceOfSeeds: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [USENET] }));
  },
  play: async ({ canvas }) => {
    const row = within(await canvas.findByTestId("request-version"));

    await expect(row.getByTestId("request-version-meta").textContent).toBe(
      `NZBgeek${SEP}EPUB${SEP}2.1${NBSP}MB${SEP}Usenet`,
    );
  },
};

export const EachChooseButtonIsDescribedByItsOwnVersion: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, REVISED] }));
  },
  play: async ({ canvas }) => {
    const [best, revised] = await canvas.findAllByRole("button", {
      name: "Choose",
    });

    await expect(best).toHaveAccessibleDescription(
      /^Hyperion - Dan Simmons EPUB Books\s·\sEPUB\s·\s2\.4\sMB\s·\s12\sseeds Best match$/,
    );
    await expect(revised).toHaveAccessibleDescription(
      /^Hyperion - Dan Simmons EPUB \[Gollancz, corrected contents v2\] Books\s·\sEPUB\s·\s2\.4\sMB\s·\s37\sseeds$/,
    );
  },
};

export const AVersionRowLeavesOutAnUnnamedSourceAndMissingSeeders: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [UNNAMED] }));
  },
  play: async ({ canvas }) => {
    const row = within(await canvas.findByTestId("request-version"));

    await expect(row.getByTestId("request-version-name").textContent).toBe(
      "Hyperion by Dan Simmons",
    );
    await expect(row.getByTestId("request-version-meta").textContent).toBe(
      `Format unknown${SEP}Size unknown`,
    );
  },
};

export const DetailsRevealWhereEachVersionCameFromAndWhatItIsCalled: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB, PDF] }));
  },
  play: async ({ canvas, userEvent }) => {
    const rows = await canvas.findAllByTestId("request-version");
    await expect(canvas.queryByTestId("request-details")).toBeNull();
    const toggle = canvas.getByTestId("request-details-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getAllByTestId("request-details")).toHaveLength(2);
    const details = within(versionAt(rows, 1)).getByTestId("request-details");
    await expect(details).toHaveTextContent("Library Ink");
    await expect(details).toHaveTextContent(
      "Simmons, Dan - Hyperion (retail).pdf",
    );
    await userEvent.click(toggle);
    await expect(canvas.queryByTestId("request-details")).toBeNull();
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
    await expect(canvas.getByTestId("request-chosen")).toHaveTextContent(
      "Simmons, Dan - Hyperion (retail).pdf",
    );
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
    await expect(canvas.getByTestId("request-choose")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  },
};

export const AFailedChoiceKeepsKeyboardFocusOnChoose: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      http.post("/api/requests/:id/choose", async () => {
        await held.promise;
        return new HttpResponse(null, { status: 409 });
      }),
      ...seed({ state: "choose", versions: [EPUB] }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const choose = await canvas.findByTestId("request-choose");
    choose.focus();

    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(choose).toHaveAttribute("aria-busy", "true"));
    await new Promise(requestAnimationFrame);
    held.release();

    await canvas.findByText(/Couldn’t choose that version/);
    await expect(choose).toHaveFocus();
  },
};

export const TheChooseLaneOffersCancelRequest: Story = {
  beforeEach({ msw }) {
    msw.use(...seed({ state: "choose", versions: [EPUB] }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Cancel request" }),
    ).toBeVisible();
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
    const chosen = within(await canvas.findByTestId("request-chosen"));

    await expect(chosen.getByText("Hyperion - Dan Simmons EPUB")).toBeVisible();
    await expect(chosen.getByText("2.4 MB · Books")).toBeVisible();
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
      canvas.getByRole("heading", { level: 3, name: "Ebook" }),
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

export const OnItsWayNamesTheVersionDownloading: Story = {
  beforeEach({ msw }) {
    msw.use(...seed(DOWNLOADING));
  },
  play: async ({ canvas }) => {
    const chosen = within(await canvas.findByTestId("request-chosen"));

    await expect(chosen.getByText("Hyperion - Dan Simmons EPUB")).toBeVisible();
    await expect(chosen.getByText("2.4 MB · Books")).toBeVisible();
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
        within(versionAt(rows, 0)).getByTestId("request-version-name"),
      ).toHaveTextContent("Simmons, Dan - Hyperion (retail).pdf");
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
    const pane = within(canvas.getByTestId("requests-pane"));
    await expect(
      pane.getAllByRole("listitem").map((step) => step.dataset.status),
    ).toEqual(["done", "done", "done", "done"]);
    await expect(canvas.queryByTestId("request-downloading")).toBeNull();
    await expect(pane.queryByRole("button")).toBeNull();
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
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/requests/:id", 404));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Back to book" }),
    ).toHaveAttribute("href", `/books/${UUID}`);
  },
};

const OLD = Math.floor(Date.now() / 1000) - 120;
const NOT_THE_MAKER = { ...ADA, id: 2, is_admin: false };

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
    await expect(canvas.getByTestId("request-details-toggle")).toBeVisible();
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
    await expect(within(first).getByTestId("request-choose")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    held.release();
    await waitFor(() =>
      expect(canvas.getByTestId("request-state")).toHaveTextContent(
        "Version chosen",
      ),
    );
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
    const chosen = within(await canvas.findByTestId("request-chosen"));

    await expect(chosen.getByText(EPUB.title)).toBeVisible();
    await expect(
      chosen.getByText("2.4 MB · Books · about 3 min left"),
    ).toBeVisible();
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
  parameters: { user: { ...ADA, id: 3 } },
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
  // Both look the same to a reader, so the book is filed under the newest: yours.
  parameters: { user: READER },
  beforeEach({ msw }) {
    fake = requestFake(
      [
        aWireRequest({ id: 9 }),
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
    const mine = canvas.getByTestId("request-lane-ebook");
    const theirs = canvas.getByTestId("request-other-lane-ebook");

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
    // The row names the book already on screen, so it links nowhere.
    await expect(within(row).queryByRole("link")).toBeNull();
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
      expect(canvas.getByTestId("request-state")).toHaveTextContent("Looking"),
    );
    await expect(canvas.getByTestId("where")).toHaveTextContent(
      `/requests?book=${UUID}`,
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

let historyTries = 0;

export const AFailedHistoryReadOffersTryAgain: Story = {
  beforeEach({ msw }) {
    historyTries = 0;
    msw.use(
      http.get("/api/books/:uuid/requests", () => {
        historyTries += 1;
        return historyTries === 1
          ? new HttpResponse("down", { status: 500 })
          : HttpResponse.json([
              aWireListing({ request: aWireRequest() }),
              aWireListing({ request: CANCELLED_EARLIER }),
            ]);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t read this book’s request history.",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));

    await expect(
      await canvas.findByTestId("request-history-row"),
    ).toHaveTextContent("Cancelled by you");
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const AnAdminsCancelWaitsForWhoseRequestItIs: Story = {
  beforeEach({ msw }) {
    held = deferred();
    fake = requestFake([aWireRequest({ user_id: 2 })], { names: GRACE });
    msw.use(
      http.get("/api/books/:uuid/requests", async () => {
        await held.promise;
        return HttpResponse.json([
          aWireListing({
            request: aWireRequest({ user_id: 2 }),
            requester_name: "Grace Hopper",
          }),
        ]);
      }),
      bookHandler(HYPERION),
      ...fake.handlers,
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("request-looking");

    await expect(canvas.queryByTestId("request-cancel")).toBeNull();
    held.release();
    await expect(
      await canvas.findByRole("button", {
        name: "Cancel Grace Hopper’s request for Hyperion",
      }),
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

export const OnAPhoneTheDownloadAndHistoryReadAsTheCompSays: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, user: READER },
  beforeEach({ msw }) {
    msw.use(
      ...withHistory(
        {
          ...DOWNLOADING,
          expected_done_at: Math.floor(Date.now() / 1000) + 180,
        },
        CANCELLED_EARLIER,
      ),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("request-chosen");
    await expect(within(card).getByText("EPUB · 2.4 MB")).toBeVisible();
    await expect(card).toHaveTextContent("42% · about 3 min left");
    await expect(
      canvas.getByRole("listitem", { current: "step" }),
    ).toHaveTextContent(/^On its way$/);
    await expect(canvas.getByTestId("request-requester")).toHaveTextContent(
      /^AL You · just now$/,
    );

    const row = await canvas.findByTestId("request-history-row");
    await expect(row).toHaveTextContent("Ebook cancelled by you · Oct 12");
    await expect(row).toHaveTextContent("EPUB · 2.4 MB · stopped at 40%");
  },
};

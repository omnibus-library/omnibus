import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Link, Route, Routes } from "react-router";
import { expect, fireEvent, spyOn, waitFor, within } from "storybook/test";
import { ADA, storyClient } from "../../testing/AppHarness";
import type { ListenWrite } from "../../testing/audioHandlers";
import {
  listenHandlers,
  TEN_MINUTES_IN,
  wrote,
} from "../../testing/audioHandlers";
import { failing, hanging } from "../../testing/handlers";
import {
  aWireAudioBookmark,
  aWireAudioManifest,
  aWireBook,
  aWireChapter,
} from "../../testing/wire";
import { Listen } from "./Listen";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const BOOK = aWireBook({ formats: ["M4B"] });

const writes: ListenWrite[] = [];
const meta = {
  title: "Pages/Listen/Panels",
  component: Listen,
  parameters: { path: `/listen/${UUID}` },
  beforeEach({ msw }) {
    writes.length = 0;
    localStorage.clear();
    msw.use(...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN }));
  },
  render: () => (
    <Routes>
      <Route path="/listen/:uuid" element={<Listen />} />
    </Routes>
  ),
} satisfies Meta<typeof Listen>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openChapters(canvas: ReturnType<typeof within>) {
  await canvas.findByText("Now playing · Chapter 1 of 3");
  fireEvent.click(canvas.getByRole("button", { name: "Chapters ↑" }));
  return within(await canvas.findByTestId("chapters-drawer"));
}

export const ChaptersDrawer: Story = {
  play: async ({ canvas }) => {
    const drawer = await openChapters(canvas);

    await expect(drawer.getByTestId("chapter-row-current")).toHaveTextContent(
      "▶Departures1:00:00 · 50:00 left",
    );
    await expect(
      drawer.getAllByTestId("chapter-row-upcoming")[0],
    ).toHaveTextContent("2The Long Water1:00:00");
    await expect(
      canvas.getByRole("button", { name: "Chapters ↓" }),
    ).toBeInTheDocument();
  },
};

export const ChaptersDrawerSeeks: Story = {
  play: async ({ canvas }) => {
    const drawer = await openChapters(canvas);

    fireEvent.click(drawer.getByText("Landfall"));

    await waitFor(() =>
      expect(wrote(writes, "POST /api/progress")).toMatchObject([
        { audio_position_seconds: 7200 },
      ]),
    );
    await waitFor(() =>
      expect(drawer.getAllByTestId("chapter-row-played")).toHaveLength(2),
    );
    await expect(drawer.getAllByText("✓")).toHaveLength(2);
    await expect(drawer.getByTestId("chapter-row-current")).toHaveTextContent(
      "▶Landfall",
    );
  },
};

let consoleError: ReturnType<typeof spyOn>;

export const ChaptersSharingAStartAllShow: Story = {
  beforeEach({ msw }) {
    // Installed before the render, which is where a duplicate key is reported.
    consoleError = spyOn(console, "error");
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        row: TEN_MINUTES_IN,
        manifest: aWireAudioManifest({
          chapters: [
            aWireChapter({ title: "Opening Credits", duration_seconds: 0 }),
            aWireChapter({ ordinal: 2, title: "Chapter One" }),
          ],
        }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 2 of 2");
    fireEvent.click(canvas.getByRole("button", { name: "Chapters ↑" }));
    const drawer = within(await canvas.findByTestId("chapters-drawer"));

    await expect(drawer.getByText("Opening Credits")).toBeInTheDocument();
    await expect(drawer.getByText("Chapter One")).toBeInTheDocument();
    await expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
      "same key",
    );
  },
};

export const NoChapters: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        manifest: aWireAudioManifest({ chapters: [] }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing");
    fireEvent.click(canvas.getByRole("button", { name: "Chapters ↑" }));

    await expect(await canvas.findByText("No chapters")).toBeInTheDocument();
  },
};

export const DrawersCloseFromTheirScrimAndButton: Story = {
  play: async ({ canvas, canvasElement }) => {
    await openChapters(canvas);

    const scrim = canvasElement.querySelector(".lp-scrim") as Element;
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim);
    await waitFor(() =>
      expect(canvas.queryByTestId("chapters-drawer")).toBeNull(),
    );

    fireEvent.click(canvas.getByRole("button", { name: "Chapters ↑" }));
    fireEvent.click(await canvas.findByRole("button", { name: "Close ↓" }));
    await waitFor(() =>
      expect(canvas.queryByTestId("chapters-drawer")).toBeNull(),
    );
  },
};

export const DrawersCloseOnEscape: Story = {
  play: async ({ canvas }) => {
    await openChapters(canvas);

    fireEvent.keyDown(canvas.getByRole("dialog", { name: "Chapters" }), {
      key: "Escape",
    });

    await waitFor(() =>
      expect(canvas.queryByTestId("chapters-drawer")).toBeNull(),
    );
  },
};

export const OnePaneAtATime: Story = {
  play: async ({ canvas }) => {
    await openChapters(canvas);

    fireEvent.click(canvas.getByTestId("listen-bookmark"));

    await expect(
      await canvas.findByTestId("bookmarks-drawer"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("chapters-drawer")).toBeNull();
  },
};

async function openBookmarks(canvas: ReturnType<typeof within>) {
  await canvas.findByText("Now playing · Chapter 1 of 3");
  fireEvent.click(canvas.getByTestId("listen-bookmark"));
  return within(await canvas.findByTestId("bookmarks-drawer"));
}

export const NoBookmarks: Story = {
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);

    await expect(
      await drawer.findByText("No bookmarks yet"),
    ).toBeInTheDocument();
  },
};

export const BookmarksWaitInsteadOfReadingAsEmpty: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/bookmarks/book/:uuid"));
  },
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);

    await expect(
      await drawer.findByText("Loading your bookmarks"),
    ).toBeInTheDocument();
    await expect(drawer.queryByText("No bookmarks yet")).toBeNull();
  },
};

export const BookmarksFailingToLoadSaySo: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/bookmarks/book/:uuid", 500));
  },
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);

    await expect(await drawer.findByRole("alert")).toHaveTextContent(
      "Couldn't load your bookmarks",
    );
    await expect(drawer.queryByText("No bookmarks yet")).toBeNull();
  },
};

let bookmarksDown = false;

export const BookmarksKeepTheirRowsWhenARefreshFails: Story = {
  beforeEach({ msw }) {
    bookmarksDown = false;
    msw.use(
      http.get("/api/bookmarks/book/:uuid", () =>
        bookmarksDown
          ? new HttpResponse("no", { status: 500 })
          : HttpResponse.json([aWireAudioBookmark()]),
      ),
    );
  },
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);
    await drawer.findByTestId("bookmark-row");

    bookmarksDown = true;
    const key = ["audio-bookmarks", UUID];
    await storyClient().refetchQueries({ queryKey: key });
    await waitFor(() =>
      expect(storyClient().getQueryState(key)?.status).toBe("error"),
    );
    // Let the failed state reach the render before looking for what it shows.
    await new Promise((resolve) => setTimeout(resolve));

    await expect(drawer.getByTestId("bookmark-row")).toBeInTheDocument();
    await expect(drawer.queryByRole("alert")).toBeNull();
  },
};

export const BookmarkAdds: Story = {
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);

    fireEvent.click(drawer.getByRole("button", { name: "+ Bookmark" }));

    const row = await drawer.findByTestId("bookmark-row");
    await expect(row).toHaveClass("fresh");
    await expect(row).toHaveTextContent("Ch. 1 · Departures10:00");
    await expect(wrote(writes, "POST /api/bookmarks")).toMatchObject([
      { book_uuid: UUID, position: "600" },
    ]);
    await expect(canvas.getByTestId("bookmark-toast")).toHaveTextContent(
      "Bookmark saved10:00 · Ch. 1 · Departures",
    );
    await waitFor(
      () => expect(canvas.queryByTestId("bookmark-toast")).toBeNull(),
      { timeout: 4000 },
    );
  },
};

export const BookmarkRowActions: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        row: TEN_MINUTES_IN,
        // A reader bookmark of the same book isn't one an audiobook can play to.
        bookmarks: [
          aWireAudioBookmark({ id: 1, position: "4000" }),
          aWireAudioBookmark({ id: 2, position: "epubcfi(/6/4)" }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);
    const row = within(await drawer.findByTestId("bookmark-row"));
    await expect(drawer.getAllByTestId("bookmark-row")).toHaveLength(1);

    fireEvent.click(row.getByText("Ch. 2 · The Long Water"));
    await waitFor(() =>
      expect(wrote(writes, "POST /api/progress")).toMatchObject([
        { audio_position_seconds: 4000 },
      ]),
    );

    fireEvent.click(row.getByRole("button", { name: "Add a note…" }));
    const note = row.getByPlaceholderText("Add a note…");
    fireEvent.change(note, { target: { value: "  The reveal " } });
    fireEvent.keyDown(note, { key: "Enter" });
    await waitFor(() =>
      expect(wrote(writes, "PUT /api/bookmarks/1")).toEqual([
        { title: "The reveal" },
      ]),
    );
    await expect(
      await row.findByRole("button", { name: "The reveal" }),
    ).toBeInTheDocument();

    fireEvent.click(row.getByRole("button", { name: "The reveal" }));
    fireEvent.change(row.getByPlaceholderText("Add a note…"), {
      target: { value: "" },
    });
    fireEvent.focusOut(row.getByPlaceholderText("Add a note…"));
    await waitFor(() =>
      expect(wrote(writes, "PUT /api/bookmarks/1")).toEqual([
        { title: "The reveal" },
        { title: null },
      ]),
    );

    fireEvent.click(row.getByRole("button", { name: "Delete bookmark" }));
    await waitFor(() =>
      expect(wrote(writes, "DELETE /api/bookmarks/1")).toHaveLength(1),
    );
    await expect(
      await drawer.findByText("No bookmarks yet"),
    ).toBeInTheDocument();
  },
};

export const FailedDeleteKeepsTheRow: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.delete("/api/bookmarks/:id", () => {
        writes.push({ request: "refused DELETE", body: null });
        return new HttpResponse("failed with 500", { status: 500 });
      }),
      ...listenHandlers(BOOK, {
        writes,
        row: TEN_MINUTES_IN,
        bookmarks: [aWireAudioBookmark()],
      }),
    );
  },
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);
    const row = within(await drawer.findByTestId("bookmark-row"));

    fireEvent.click(row.getByRole("button", { name: "Delete bookmark" }));

    await waitFor(() =>
      expect(wrote(writes, "refused DELETE")).toHaveLength(1),
    );
    await expect(drawer.getByTestId("bookmark-row")).toBeInTheDocument();
  },
};

const RATE_PUT = "PUT /api/audiobooks/playback-rate";

async function openSpeed(canvas: ReturnType<typeof within>) {
  await canvas.findByText("Now playing · Chapter 1 of 3");
  fireEvent.click(canvas.getByRole("button", { name: "Playback speed" }));
  return within(await canvas.findByRole("dialog", { name: "Playback speed" }));
}

export const SpeedPanel: Story = {
  play: async ({ canvas }) => {
    const panel = await openSpeed(canvas);

    for (const label of [
      "0.5×",
      "0.8×",
      "1.0×",
      "1.1×",
      "1.2×",
      "1.5×",
      "1.8×",
      "2.0×",
    ]) {
      await expect(
        panel.getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    await expect(panel.getByRole("button", { name: "1.0×" })).toHaveClass("on");
    await expect(
      panel.getByRole("slider", { name: "Fine-tune speed" }),
    ).toHaveValue("1");
    await expect(canvas.getByRole("dialog")).toHaveFocus();
  },
};

export const SpeedPresetApplies: Story = {
  play: async ({ canvas }) => {
    const panel = await openSpeed(canvas);

    fireEvent.click(panel.getByRole("button", { name: "1.5×" }));

    await expect(canvas.getByTestId("listen-rate")).toHaveTextContent("1.50×");
    await expect(panel.getByRole("button", { name: "1.5×" })).toHaveClass("on");
    await expect(
      (canvas.getByTestId("listen-audio") as HTMLAudioElement).playbackRate,
    ).toBe(1.5);
    await expect(
      localStorage.getItem(`omn.listening.rate::${ADA.id}::${UUID}`),
    ).toBe("1.5");
    await waitFor(() =>
      expect(wrote(writes, RATE_PUT)).toEqual([{ playback_rate: 1.5 }]),
    );
  },
};

export const SpeedStepperAndSliderSnapToTheGrid: Story = {
  play: async ({ canvas }) => {
    const panel = await openSpeed(canvas);

    fireEvent.click(panel.getByRole("button", { name: "Increase speed" }));
    await expect(await panel.findByText("1.05×")).toBeInTheDocument();
    fireEvent.change(panel.getByRole("slider", { name: "Fine-tune speed" }), {
      target: { value: "2.45" },
    });

    await expect(await panel.findByText("2.45×")).toBeInTheDocument();
    await waitFor(() =>
      expect(wrote(writes, RATE_PUT)).toEqual([
        { playback_rate: 1.05 },
        { playback_rate: 2.45 },
      ]),
    );
  },
};

export const SpeedPanelClosesOnEscapeAndScrim: Story = {
  play: async ({ canvas, canvasElement }) => {
    await openSpeed(canvas);

    fireEvent.keyDown(canvas.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());

    fireEvent.click(canvas.getByRole("button", { name: "Playback speed" }));
    await canvas.findByRole("dialog");
    const scrim = canvasElement.querySelector(".lp-scrim") as Element;
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim);
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
  },
};

export const SpeedSaveFailureClearsOnTheNextSave: Story = {
  beforeEach({ msw }) {
    let puts = 0;
    msw.use(
      http.put("/api/audiobooks/:uuid/playback-rate", () =>
        puts++ === 0
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json({
              book_uuid: UUID,
              playback_rate: 1.2,
              updated_at: 1,
            }),
      ),
      ...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN }),
    );
  },
  play: async ({ canvas }) => {
    const panel = await openSpeed(canvas);

    fireEvent.click(panel.getByRole("button", { name: "1.5×" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      /^Could not save playback speed: /,
    );

    fireEvent.click(panel.getByRole("button", { name: "1.2×" }));
    await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
  },
};

export const ServerSpeedWinsAtBoot: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN, rate: 1.25 }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("1.25×")).toBeInTheDocument();
    await canvas.findByText("Now playing · Chapter 1 of 3");
    await expect(wrote(writes, RATE_PUT)).toEqual([]);
  },
};

export const ThisDevicesSpeedSeedsTheServer: Story = {
  beforeEach() {
    localStorage.setItem(`omn.listening.rate::${ADA.id}::${UUID}`, "1.5");
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("1.50×")).toBeInTheDocument();
    await waitFor(() =>
      expect(wrote(writes, RATE_PUT)).toEqual([{ playback_rate: 1.5 }]),
    );
  },
};

async function openSleep(
  canvas: ReturnType<typeof within>,
  kicker = "Now playing · Chapter 1 of 3",
) {
  await canvas.findByText(kicker);
  fireEvent.click(canvas.getByTestId("listen-sleep"));
  return within(await canvas.findByRole("dialog", { name: "Sleep timer" }));
}

export const SleepPanelOff: Story = {
  play: async ({ canvas }) => {
    const panel = await openSleep(canvas);

    await expect(canvas.getByTestId("listen-sleep")).toHaveTextContent(
      "Sleep · off",
    );
    await expect(panel.getByTestId("sleep-status")).toHaveTextContent("—");
    await expect(panel.getByText("inactive")).toBeInTheDocument();
    await expect(panel.getByRole("button", { name: "Off" })).toHaveClass("on");
    await expect(
      panel.getByRole("button", { name: "Fade out volume" }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const label of [
      "15 min",
      "30 min",
      "45 min",
      "1 hour",
      "2 hours",
      "3 hours",
      "4 hours",
    ]) {
      await expect(
        panel.getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
  },
};

export const SleepPresetArmsAndOffRestoresTheListenersVolume: Story = {
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole("slider", { name: "Volume" });
    fireEvent.change(slider, { target: { value: "0.4" } });
    const panel = await openSleep(canvas);

    fireEvent.click(panel.getByRole("button", { name: "15 min" }));

    await expect(canvas.getByTestId("listen-sleep")).toHaveTextContent(
      /^Sleep · 15:00$/,
    );
    await expect(panel.getByTestId("sleep-status")).toHaveTextContent("15:00");
    await expect(panel.getByText("remaining")).toBeInTheDocument();
    await expect(panel.getByRole("button", { name: "15 min" })).toHaveClass(
      "on",
    );

    fireEvent.click(panel.getByRole("button", { name: "Off" }));

    await expect(canvas.getByTestId("listen-sleep")).toHaveTextContent(
      "Sleep · off",
    );
    await expect(
      (canvas.getByTestId("listen-audio") as HTMLAudioElement).volume,
    ).toBeCloseTo(0.4);
  },
};

export const SleepEndOfChapterReadsWallTimeToTheBoundary: Story = {
  play: async ({ canvas }) => {
    const panel = await openSleep(canvas);

    fireEvent.click(panel.getByRole("button", { name: "End of chapter" }));

    // Ten minutes into a one-hour chapter, at 1x.
    await expect(panel.getByTestId("sleep-status")).toHaveTextContent("50:00");
    await expect(
      panel.getByRole("button", { name: "End of chapter" }),
    ).toHaveClass("on");
    await expect(canvas.getByTestId("listen-sleep")).toHaveTextContent(
      "Sleep · 50:00",
    );

    // A seek into the next chapter moves the boundary to that chapter's end.
    fireEvent.click(canvas.getByRole("button", { name: "Next chapter" }));

    await expect(
      within(canvas.getByRole("dialog", { name: "Sleep timer" })).getByTestId(
        "sleep-status",
      ),
    ).toHaveTextContent("1:00:00");
  },
};

export const SleepEndOfChapterNeedsChapters: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        manifest: aWireAudioManifest({ chapters: [] }),
      }),
    );
  },
  play: async ({ canvas }) => {
    const panel = await openSleep(canvas, "Now playing");

    await expect(
      panel.getByRole("button", { name: "End of chapter" }),
    ).toBeDisabled();
  },
};

export const SleepFadeToggles: Story = {
  play: async ({ canvas }) => {
    const panel = await openSleep(canvas);

    fireEvent.click(panel.getByRole("button", { name: "Fade out volume" }));

    await expect(
      panel.getByRole("button", { name: "Fade out volume" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};

export const SleepCountdownSurvivesLeavingThePlayer: Story = {
  render: () => (
    <>
      <Link to="/">Leave the player</Link>
      <Routes>
        <Route path="/listen/:uuid" element={<Listen />} />
        <Route
          path="/"
          element={<Link to={`/listen/${UUID}`}>Return to the player</Link>}
        />
      </Routes>
    </>
  ),
  play: async ({ canvas }) => {
    const panel = await openSleep(canvas);
    fireEvent.click(panel.getByRole("button", { name: "15 min" }));

    fireEvent.click(canvas.getByRole("link", { name: "Leave the player" }));
    await canvas.findByRole("link", { name: "Return to the player" });
    fireEvent.click(canvas.getByRole("link", { name: "Return to the player" }));

    // Only a timer that kept ticking while the page was gone can have moved.
    await expect(
      await canvas.findByText(/^Sleep · 14:5\d$/),
    ).toBeInTheDocument();
  },
};

const SYNC = "POST /api/books/sync-point";

async function syncHere(canvas: ReturnType<typeof within>) {
  await canvas.findByText("Now playing · Chapter 1 of 3");
  const button = canvas.getByTestId("listen-sync-here");
  fireEvent.click(button);
  return button;
}

export const SyncHereDeclaresTheLoadedFile: Story = {
  play: async ({ canvas }) => {
    const button = await syncHere(canvas);

    await waitFor(() => expect(button).toHaveTextContent("Synced ✓"));
    await expect(wrote(writes, SYNC)).toEqual([
      {
        book_uuid: UUID,
        format: "audio",
        audio_book_file_id: 917,
        audio_seconds: 600,
      },
    ]);
  },
};

export const SyncHereShowsBusyWhileTheRequestRuns: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/books/:uuid/sync-point", "post"));
  },
  play: async ({ canvas }) => {
    const button = await syncHere(canvas);

    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    await expect(button).toBeDisabled();
    await expect(button).toHaveTextContent("Syncing…");
  },
};

export const SyncHereAsksToLinkFirst: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        syncRefusal: {
          status: 409,
          message:
            "confirm the alignment first — this book has several audio files",
        },
      }),
    );
  },
  play: async ({ canvas }) => {
    const button = await syncHere(canvas);

    await waitFor(() => expect(button).toHaveTextContent("Link formats first"));
  },
};

export const SyncHereReportsAFailure: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        syncRefusal: { status: 500, message: "boom" },
      }),
    );
  },
  play: async ({ canvas }) => {
    const button = await syncHere(canvas);

    await waitFor(() => expect(button).toHaveTextContent("Sync failed"));
    await expect(button).toHaveAttribute("aria-busy", "false");
  },
};

export const SyncHereIsOffWhenOffline: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    try {
      fireEvent(window, new Event("offline"));

      await waitFor(() =>
        expect(canvas.getByTestId("listen-sync-here")).toBeDisabled(),
      );
    } finally {
      // Drops the stub so the prototype's getter shows again.
      delete (navigator as { onLine?: boolean }).onLine;
      // Query's online manager would hold every later story's fetches otherwise.
      fireEvent(window, new Event("online"));
    }
  },
};

export const FollowAtBootStartsAtTheMappedSpot: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        row: TEN_MINUTES_IN,
        resume: {
          state: "candidate",
          follow: true,
          candidate: {
            book_file_id: 917,
            audio_position_seconds: 1200,
            confidence: "linear",
            source_client_updated_at: 1_760_000_000,
            source_format: "epub",
            target: "audio",
          },
        },
      }),
    );
  },
  play: async ({ canvas }) => {
    const times = await canvas.findByTestId("listen-scrub-times");

    await expect(await within(times).findByText("20:00")).toBeInTheDocument();
    await expect(wrote(writes, "POST /api/progress")).toEqual([]);
  },
};

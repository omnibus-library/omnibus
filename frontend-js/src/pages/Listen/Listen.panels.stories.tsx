import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { ADA } from "../../testing/AppHarness";
import type { ListenWrite } from "../../testing/audioHandlers";
import { listenHandlers } from "../../testing/audioHandlers";
import {
  aWireAudioBookmark,
  aWireAudioManifest,
  aWireBook,
  aWirePosition,
} from "../../testing/wire";
import { Listen } from "./Listen";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const BOOK = aWireBook({ formats: ["M4B"] });

const writes: ListenWrite[] = [];
const wrote = (request: string) =>
  writes.filter((w) => w.request === request).map((w) => w.body);

// Ten minutes into the first of three hour-long chapters.
const TEN_MINUTES_IN = aWirePosition({
  format: "audio",
  progress_percent: null,
  audio_position_seconds: 600,
  book_file_id: 917,
});

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
      expect(wrote("POST /api/progress")).toMatchObject([
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

    fireEvent.click(canvasElement.querySelector(".lp-scrim") as Element);
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

export const BookmarkAdds: Story = {
  play: async ({ canvas }) => {
    const drawer = await openBookmarks(canvas);

    fireEvent.click(drawer.getByRole("button", { name: "+ Bookmark" }));

    const row = await drawer.findByTestId("bookmark-row");
    await expect(row).toHaveClass("fresh");
    await expect(row).toHaveTextContent("Ch. 1 · Departures10:00");
    await expect(wrote("POST /api/bookmarks")).toMatchObject([
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
      expect(wrote("POST /api/progress")).toMatchObject([
        { audio_position_seconds: 4000 },
      ]),
    );

    fireEvent.click(row.getByRole("button", { name: "Add a note…" }));
    const note = row.getByPlaceholderText("Add a note…");
    fireEvent.change(note, { target: { value: "  The reveal " } });
    fireEvent.keyDown(note, { key: "Enter" });
    await waitFor(() =>
      expect(wrote("PUT /api/bookmarks/1")).toEqual([{ title: "The reveal" }]),
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
      expect(wrote("PUT /api/bookmarks/1")).toEqual([
        { title: "The reveal" },
        { title: null },
      ]),
    );

    fireEvent.click(row.getByRole("button", { name: "Delete bookmark" }));
    await waitFor(() =>
      expect(wrote("DELETE /api/bookmarks/1")).toHaveLength(1),
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

    await waitFor(() => expect(wrote("refused DELETE")).toHaveLength(1));
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
      expect(wrote(RATE_PUT)).toEqual([{ playback_rate: 1.5 }]),
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
      expect(wrote(RATE_PUT)).toEqual([
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
    fireEvent.click(canvasElement.querySelector(".lp-scrim") as Element);
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
    await expect(wrote(RATE_PUT)).toEqual([]);
  },
};

export const ThisDevicesSpeedSeedsTheServer: Story = {
  beforeEach() {
    localStorage.setItem(`omn.listening.rate::${ADA.id}::${UUID}`, "1.5");
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("1.50×")).toBeInTheDocument();
    await waitFor(() =>
      expect(wrote(RATE_PUT)).toEqual([{ playback_rate: 1.5 }]),
    );
  },
};

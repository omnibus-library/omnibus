import type { Meta, StoryObj } from "@storybook/react-vite";
import { act } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Link, Route, Routes } from "react-router";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import {
  BOOK,
  listenHandlers,
  TEN_MINUTES_IN,
  twoFiles,
  UUID,
  writes,
  wrote,
} from "../../testing/audioHandlers";
import { failing, hanging } from "../../testing/handlers";
import {
  aWireAudioManifest,
  aWireBook,
  aWireChapter,
  aWireHlsManifest,
  aWirePosition,
  aWireReadStatus,
} from "../../testing/wire";
import { Listen } from "./Listen";

const meta = {
  title: "Pages/Listen",
  component: Listen,
  parameters: { path: `/listen/${UUID}` },
  beforeEach({ msw }) {
    writes.length = 0;
    // A position or volume an earlier story saved would resume this one.
    localStorage.clear();
    msw.use(...listenHandlers(BOOK, { writes }));
  },
  // The page reads its uuid from the route, as it does under the app router.
  render: () => (
    <Routes>
      <Route path="/listen/:uuid" element={<Listen />} />
      <Route path="/" element={<p>The library</p>} />
    </Routes>
  ),
} satisfies Meta<typeof Listen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Opening the audiobook"),
    ).toBeInTheDocument();
  },
};

export const BookError: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/");
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks/:uuid", 404));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Audiobook not found."),
    ).toBeInTheDocument();
  },
};

export const ManifestFailed: Story = {
  beforeEach({ msw }) {
    msw.use(...listenHandlers(BOOK, { writes, manifest: null }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Playback failed.",
    );
  },
};

export const Preparing: Story = {
  beforeEach({ msw }) {
    msw.use(...listenHandlers(BOOK, { writes, manifest: aWireHlsManifest() }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Preparing your audiobook…"),
    ).toBeInTheDocument();
  },
};

export const Ready: Story = {
  play: async ({ canvas }) => {
    const link = await canvas.findByRole("link", {
      name: "Open details for Aurora Station, Vol. 1",
    });
    await expect(
      within(link).getByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    for (const name of [
      "Play",
      "Back 30 seconds",
      "Forward 30 seconds",
      "Playback speed",
    ]) {
      await expect(canvas.getByRole("button", { name })).toBeInTheDocument();
    }
    await expect(
      canvas.getByRole("slider", { name: "Volume" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByText("Now playing · Chapter 1 of 3"),
    ).toBeInTheDocument();
  },
};

export const ResumesSavedPosition: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        row: aWirePosition({
          format: "audio",
          progress_percent: null,
          audio_position_seconds: 600,
          book_file_id: 917,
        }),
      }),
    );
  },
  play: async ({ canvas }) => {
    const times = await canvas.findByTestId("listen-scrub-times");
    await expect(await within(times).findByText("10:00")).toBeInTheDocument();
    await expect(wrote(writes, "POST /api/progress")).toEqual([]);
  },
};

// The element has no media to load here: metadata is signalled by hand, then the spot set on it directly.
async function skipForwardFrom600(canvas: ReturnType<typeof within>) {
  await canvas.findByText("Now playing · Chapter 1 of 3");
  const audio = canvas.getByTestId("listen-audio") as HTMLAudioElement;
  fireEvent.loadedMetadata(audio);
  audio.currentTime = 600;
  fireEvent.click(canvas.getByRole("button", { name: "Forward 30 seconds" }));
}

export const SkipPostsPosition: Story = {
  play: async ({ canvas }) => {
    await skipForwardFrom600(canvas);

    await waitFor(() =>
      expect(wrote(writes, "POST /api/progress")).toEqual([
        {
          book_uuid: UUID,
          format: "audio",
          audio_position_seconds: 630,
          book_file_id: 917,
        },
      ]),
    );
  },
};

export const SkipLeavesOutAnUnknownFile: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        manifest: aWireAudioManifest({ book_file_id: 0 }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await skipForwardFrom600(canvas);

    await waitFor(() =>
      expect(wrote(writes, "POST /api/progress")).toEqual([
        { book_uuid: UUID, format: "audio", audio_position_seconds: 630 },
      ]),
    );
  },
};

export const VolumeIsSaved: Story = {
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole("slider", { name: "Volume" });

    fireEvent.change(slider, { target: { value: "0.4" } });

    await waitFor(() =>
      expect(localStorage.getItem("omnibus.listen.volume")).toBe("0.4"),
    );
    const audio = canvas.getByTestId("listen-audio") as HTMLAudioElement;
    await expect(audio.volume).toBeCloseTo(0.4);
  },
};

export const ChapterNav: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");

    fireEvent.click(canvas.getByRole("button", { name: "Next chapter" }));

    await expect(
      await canvas.findByText("Now playing · Chapter 2 of 3"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("Ch. 2 · The Long Water"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(wrote(writes, "POST /api/progress")).toMatchObject([
        { audio_position_seconds: 3600 },
      ]),
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
    await expect(await canvas.findByText("Now playing")).toBeInTheDocument();
    for (const name of ["Previous chapter", "Next chapter"]) {
      await expect(canvas.getByRole("button", { name })).toBeDisabled();
    }
  },
};

export const ScrubberPreviewsThenSeeksOnRelease: Story = {
  play: async ({ canvas }) => {
    const seek = await canvas.findByRole("slider", { name: "Seek" });
    await waitFor(() => expect(seek).toHaveAttribute("max", "10800"));

    fireEvent.input(seek, { target: { value: "1800" } });

    // The bubble and the elapsed time both preview the target.
    await expect(await canvas.findAllByText("30:00")).toHaveLength(2);
    await expect(wrote(writes, "POST /api/progress")).toEqual([]);

    fireEvent.change(seek);

    await waitFor(() =>
      expect(wrote(writes, "POST /api/progress")).toEqual([
        {
          book_uuid: UUID,
          format: "audio",
          audio_position_seconds: 1800,
          book_file_id: 917,
        },
      ]),
    );
  },
};

export const OnlyTimeLeftScalesWithSpeed: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        rate: 2,
        row: aWirePosition({
          format: "audio",
          progress_percent: null,
          audio_position_seconds: 600,
          book_file_id: 917,
        }),
        manifest: aWireAudioManifest({
          parts: [
            {
              ordinal: 1,
              url: "/api/audiobooks/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0/parts/1?file_id=917",
              duration_seconds: 3600,
              mime: "audio/mpeg",
            },
          ],
          total_duration_seconds: 3600,
          chapters: [
            aWireChapter({ title: "One", duration_seconds: 1800 }),
            aWireChapter({
              ordinal: 2,
              title: "Two",
              start_seconds: 1800,
              duration_seconds: 1800,
            }),
          ],
        }),
      }),
    );
  },
  play: async ({ canvas }) => {
    const times = within(await canvas.findByTestId("listen-scrub-times"));

    await expect(
      await times.findByText("· 25:00 remaining"),
    ).toBeInTheDocument();
    await expect(times.getByText("10:00")).toBeInTheDocument();
    await expect(times.getByText("1:00:00")).toBeInTheDocument();
  },
};

export const ShowsBufferingWhilePlaying: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");
    const audio = canvas.getByTestId("listen-audio") as HTMLAudioElement;
    // No media loads here, so the element is made to look like it is playing and waiting.
    Object.defineProperty(audio, "paused", { value: false });

    fireEvent.play(audio);

    await expect(
      await canvas.findByTestId("listen-buffering"),
    ).toHaveTextContent("Buffering…");
  },
};

const audioOf = (canvas: ReturnType<typeof within>) =>
  canvas.getByTestId("listen-audio") as HTMLAudioElement;

export const FirstPlayMarksTheBookReading: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");

    fireEvent.play(audioOf(canvas));

    await waitFor(() =>
      expect(wrote(writes, "PUT /api/read-status")).toEqual([
        { book_uuid: UUID, status: "reading" },
      ]),
    );
  },
};

export const PagehideReportsAListeningSession: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");
    const audio = audioOf(canvas);
    Object.defineProperty(audio, "paused", { value: false });
    // A hand-set clock: Storybook's instrumented spy recurses through Date.now.
    const realNow = Date.now;
    Date.now = () => 1_760_000_000_000;
    try {
      // act flushes the effect that starts the clock, so the time moves on after it began.
      act(() => {
        fireEvent.play(audio);
      });
      Date.now = () => 1_760_000_006_000;

      fireEvent(window, new Event("pagehide"));

      await waitFor(() =>
        expect(wrote(writes, "POST /api/progress/sessions")).toMatchObject([
          [
            {
              book_uuid: UUID,
              format: "audio",
              started_at: 1_760_000_000,
              ended_at: 1_760_000_006,
              progress_units: 6,
            },
          ],
        ]),
      );
    } finally {
      Date.now = realNow;
    }
  },
};

const requestedFiles: (string | null)[] = [];

export const EndOfAFileOpensTheNextOneUnseeded: Story = {
  beforeEach({ msw }) {
    requestedFiles.length = 0;
    msw.use(
      twoFiles(requestedFiles),
      ...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN }),
    );
  },
  play: async ({ canvas }) => {
    const times = async () =>
      within(await canvas.findByTestId("listen-scrub-times"));
    await expect(await (await times()).findByText("10:00")).toBeInTheDocument();

    fireEvent.ended(audioOf(canvas));

    await waitFor(() => expect(requestedFiles).toEqual(["917", "918"]));
    // The saved 10:00 belongs to file 917, so the next file starts from its top.
    await expect(await (await times()).findByText("0:00")).toBeInTheDocument();
    await expect(audioOf(canvas).paused).toBe(true);
    await expect(wrote(writes, "POST /api/progress")).toEqual([]);
    await expect(wrote(writes, "PUT /api/read-status")).toEqual([]);
  },
};

export const EndOfTheLastFileFinishesTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        readStatus: aWireReadStatus({ status: "reading" }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");

    fireEvent.ended(audioOf(canvas));

    await waitFor(() =>
      expect(wrote(writes, "PUT /api/read-status")).toEqual([
        { book_uuid: UUID, status: "finished" },
      ]),
    );
  },
};

export const AFileIdInTheLinkPicksTheFileTheManifestIsAskedFor: Story = {
  parameters: { path: `/listen/${UUID}?file_id=918` },
  beforeEach({ msw }) {
    requestedFiles.length = 0;
    msw.use(twoFiles(requestedFiles));
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");

    await expect(requestedFiles).toEqual(["918"]);
  },
};

export const SigningOutReportsTheListeningBeforeTheLogout: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN }),
      http.post("/api/auth/logout", () => {
        writes.push({ request: "POST /api/auth/logout", body: null });
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");
    const audio = audioOf(canvas);
    const realNow = Date.now;
    Date.now = () => 1_760_000_000_000;
    try {
      act(() => {
        fireEvent.play(audio);
      });
      Date.now = () => 1_760_000_006_000;

      await userEvent.click(
        canvas.getByRole("button", { name: "Open user menu" }),
      );
      await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));

      const requests = () =>
        writes
          .map((w) => w.request)
          .filter((r) => r !== "PUT /api/read-status");
      await waitFor(() =>
        expect(requests().at(-1)).toBe("POST /api/auth/logout"),
      );
      await expect(requests().slice(0, -1).sort()).toEqual([
        "POST /api/progress",
        "POST /api/progress/sessions",
      ]);
    } finally {
      Date.now = realNow;
    }
  },
};

export const SigningOutDoesNotWaitOnAHungSave: Story = {
  beforeEach({ msw }) {
    msw.use(
      hanging("/api/progress", "post"),
      ...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN }),
      http.post("/api/auth/logout", () => {
        writes.push({ request: "POST /api/auth/logout", body: null });
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");
    act(() => {
      fireEvent.play(audioOf(canvas));
    });

    await userEvent.click(
      canvas.getByRole("button", { name: "Open user menu" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(wrote(writes, "POST /api/auth/logout")).toHaveLength(1),
    );
  },
};

export const ADeadSavedFileFallsBackToTheDefaultFile: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/audiobooks/:uuid/manifest", ({ request }) =>
        new URL(request.url).searchParams.has("file_id")
          ? new HttpResponse("gone", { status: 404 })
          : HttpResponse.json(aWireAudioManifest()),
      ),
      ...listenHandlers(BOOK, {
        writes,
        row: aWirePosition({ ...TEN_MINUTES_IN, book_file_id: 999 }),
      }),
    );
  },
  play: async ({ canvas }) => {
    const times = await canvas.findByTestId("listen-scrub-times");

    await expect(await within(times).findByText("10:00")).toBeInTheDocument();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const ATranscodeThatFailedFailsThePlayer: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...listenHandlers(BOOK, {
        writes,
        manifest: aWireHlsManifest(),
        state: "failed",
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Playback failed.",
    );
  },
};

const SECOND_UUID = "0b9e5e0e-5f0a-4c36-9a3e-2f5d6c1d7a11";
let releaseFirstManifest = () => {};
let firstManifestAsked = false;

export const ASlowManifestNeverLandsOnTheBookThatReplacedIt: Story = {
  render: () => (
    <>
      <Link to={`/listen/${SECOND_UUID}`}>Open the second book</Link>
      <Routes>
        <Route path="/listen/:uuid" element={<Listen />} />
      </Routes>
    </>
  ),
  beforeEach({ msw }) {
    firstManifestAsked = false;
    const held = new Promise<void>((resolve) => {
      releaseFirstManifest = resolve;
    });
    msw.use(
      http.get("/api/audiobooks/:uuid/manifest", async ({ params }) => {
        if (params.uuid !== UUID) {
          return HttpResponse.json(aWireAudioManifest({ chapters: [] }));
        }
        firstManifestAsked = true;
        await held;
        return HttpResponse.json(aWireAudioManifest());
      }),
      http.get("/api/ebooks/:uuid", ({ params }) =>
        HttpResponse.json(
          params.uuid === UUID
            ? BOOK
            : aWireBook({
                unique_identifier: SECOND_UUID,
                title: "Second Book",
              }),
        ),
      ),
      ...listenHandlers(BOOK, { writes }),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(firstManifestAsked).toBe(true));
    fireEvent.click(canvas.getByRole("link", { name: "Open the second book" }));
    await canvas.findByRole("link", { name: "Open details for Second Book" });
    await waitFor(() =>
      expect(canvas.queryByTestId("listen-preparing")).toBeNull(),
    );

    releaseFirstManifest();
    // Time for the first book's answer to be acted on, were it going to be.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(canvas.getByText("Now playing")).toBeInTheDocument();
    await expect(canvas.queryByText(/Chapter 1 of 3/)).toBeNull();
  },
};

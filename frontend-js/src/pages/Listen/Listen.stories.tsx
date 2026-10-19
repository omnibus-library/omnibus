import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import type { ListenWrite } from "../../testing/audioHandlers";
import { listenHandlers } from "../../testing/audioHandlers";
import { failing, hanging } from "../../testing/handlers";
import {
  aWireAudioManifest,
  aWireBook,
  aWireHlsManifest,
  aWirePosition,
} from "../../testing/wire";
import { Listen } from "./Listen";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const BOOK = aWireBook({ formats: ["M4B"] });

const writes: ListenWrite[] = [];
const positions = () =>
  writes.filter((w) => w.request === "POST /api/progress").map((w) => w.body);

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
    await expect(positions()).toEqual([]);
  },
};

// The element has no media to seek here, so the restored spot is set on it directly.
async function skipForwardFrom600(canvas: ReturnType<typeof within>) {
  await canvas.findByText("Now playing · Chapter 1 of 3");
  const audio = canvas.getByTestId("listen-audio") as HTMLAudioElement;
  audio.currentTime = 600;
  fireEvent.click(canvas.getByRole("button", { name: "Forward 30 seconds" }));
}

export const SkipPostsPosition: Story = {
  play: async ({ canvas }) => {
    await skipForwardFrom600(canvas);

    await waitFor(() =>
      expect(positions()).toEqual([
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
      expect(positions()).toEqual([
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

import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect } from "react";
import { Link, Route, Routes } from "react-router";
import { expect, fireEvent, spyOn, waitFor, within } from "storybook/test";
import type { BookUuid } from "../../api";
import { usePlayback } from "../../playback/PlaybackProvider";
import type { ListenWrite } from "../../testing/audioHandlers";
import { listenHandlers, TEN_MINUTES_IN } from "../../testing/audioHandlers";
import { aWireBook } from "../../testing/wire";
import { Listen } from "./Listen";
import { MiniDock } from "./MiniDock";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const BOOK = aWireBook({ formats: ["M4B"] });

const writes: ListenWrite[] = [];
const wrote = (request: string) =>
  writes.filter((w) => w.request === request).map((w) => w.body);

/** Starts the book the way a player page does, so the dock has something to show. */
function Opened({ children }: { children: ReactNode }) {
  const { open } = usePlayback();
  useEffect(() => open(UUID as BookUuid, null), [open]);
  return children;
}

/** The sleep timer's countdown, which only the provider holds. */
function SleepProbe() {
  const { sleep } = usePlayback();
  return <output data-testid="sleep-probe">{String(sleep.remaining)}</output>;
}

const meta = {
  title: "Pages/Listen/MiniDock",
  component: MiniDock,
  beforeEach({ msw }) {
    writes.length = 0;
    localStorage.clear();
    msw.use(...listenHandlers(BOOK, { writes, row: TEN_MINUTES_IN }));
  },
  render: () => (
    <Opened>
      <MiniDock />
      <SleepProbe />
    </Opened>
  ),
} satisfies Meta<typeof MiniDock>;

export default meta;
type Story = StoryObj<typeof meta>;

const hostOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector(".mini-dock-host");

async function dockOf(canvas: ReturnType<typeof within>) {
  return within(await canvas.findByRole("region", { name: "Now playing" }));
}

export const EmptyUntilABookIsOpen: Story = {
  render: () => <MiniDock />,
  play: async ({ canvasElement }) => {
    await expect(hostOf(canvasElement)).toBeEmptyDOMElement();
  },
};

export const ShowsTheBookAndItsTransport: Story = {
  play: async ({ canvas }) => {
    const dock = await dockOf(canvas);

    await expect(dock.getByTestId("mini-dock-title")).toHaveTextContent(
      "Aurora Station, Vol. 1",
    );
    await expect(
      await dock.findByText(
        "Ch. 1 · Departures · 10:00 / 3:00:00 · about 2h 50m left",
      ),
    ).toBeInTheDocument();
    for (const name of [
      "Previous chapter",
      "Back 30 seconds",
      "Play",
      "Forward 30 seconds",
      "Next chapter",
    ]) {
      await expect(dock.getByRole("button", { name })).toBeInTheDocument();
    }
  },
};

export const NextChapterSeeksAndPostsThePosition: Story = {
  play: async ({ canvas }) => {
    const dock = await dockOf(canvas);
    await dock.findByText(/^Ch\. 1 · Departures/);

    fireEvent.click(dock.getByRole("button", { name: "Next chapter" }));

    await expect(
      await dock.findByText(/^Ch\. 2 · The Long Water · 1:00:00 \/ 3:00:00/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(wrote("POST /api/progress")).toMatchObject([
        { audio_position_seconds: 3600 },
      ]),
    );
  },
};

export const ExpandLinksContinueTheCurrentFile: Story = {
  play: async ({ canvas }) => {
    const dock = await dockOf(canvas);

    for (const name of ["Expand player", "Expand to full player"]) {
      await expect(dock.getByRole("link", { name })).toHaveAttribute(
        "href",
        `/listen/${UUID}`,
      );
    }
  },
};

export const OnePopoverOpensAtATimeAndTheScrimClosesIt: Story = {
  play: async ({ canvas }) => {
    const dock = await dockOf(canvas);
    const open = (testId: string) => canvas.getByTestId(testId);

    fireEvent.click(dock.getByRole("button", { name: "Playback speed" }));
    await expect(open("mini-dock-pop-speed")).toHaveClass("open");

    fireEvent.click(dock.getByRole("button", { name: "Sleep timer" }));
    await expect(open("mini-dock-pop-sleep")).toHaveClass("open");
    await expect(open("mini-dock-pop-speed")).not.toHaveClass("open");

    fireEvent.click(dock.getByRole("button", { name: "Volume" }));
    await expect(open("mini-dock-pop-vol")).toHaveClass("open");
    await expect(open("mini-dock-pop-sleep")).not.toHaveClass("open");

    fireEvent.click(canvas.getByTestId("mini-dock-scrim"));
    await expect(open("mini-dock-pop-vol")).not.toHaveClass("open");
    await expect(canvas.queryByTestId("mini-dock-scrim")).toBeNull();
  },
};

export const SpeedPopoverSetsTheSpeed: Story = {
  play: async ({ canvas }) => {
    const dock = await dockOf(canvas);
    fireEvent.click(dock.getByRole("button", { name: "Playback speed" }));

    fireEvent.click(
      within(canvas.getByTestId("mini-dock-pop-speed")).getByRole("button", {
        name: "1.5×",
      }),
    );

    await expect(
      dock.getByRole("button", { name: "Playback speed" }),
    ).toHaveTextContent("1.5×");
  },
};

export const SleepPopoverArmsTheChip: Story = {
  play: async ({ canvas }) => {
    const dock = await dockOf(canvas);
    fireEvent.click(dock.getByRole("button", { name: "Sleep timer" }));

    fireEvent.click(
      within(canvas.getByTestId("mini-dock-pop-sleep")).getByRole("button", {
        name: "15 min",
      }),
    );

    await expect(
      dock.getByRole("button", { name: "Sleep timer" }),
    ).toHaveTextContent("Sleep · 15:00");
  },
};

export const VolumePopoverSetsTheVolume: Story = {
  play: async ({ canvas }) => {
    const dock = await dockOf(canvas);
    fireEvent.click(dock.getByRole("button", { name: "Volume" }));

    fireEvent.change(canvas.getByRole("slider", { name: "Volume" }), {
      target: { value: "0.4" },
    });

    await expect(
      (canvas.getByTestId("listen-audio") as HTMLAudioElement).volume,
    ).toBeCloseTo(0.4);
  },
};

export const CloseStopsTheElementCancelsTheTimerAndHidesTheDock: Story = {
  play: async ({ canvas, canvasElement }) => {
    const dock = await dockOf(canvas);
    fireEvent.click(dock.getByRole("button", { name: "Sleep timer" }));
    fireEvent.click(
      within(canvas.getByTestId("mini-dock-pop-sleep")).getByRole("button", {
        name: "15 min",
      }),
    );
    await expect(canvas.getByTestId("sleep-probe")).toHaveTextContent("900");

    fireEvent.click(
      dock.getByRole("button", { name: "Stop and close player" }),
    );

    await waitFor(() => expect(hostOf(canvasElement)).toBeEmptyDOMElement());
    await expect(canvas.getByTestId("sleep-probe")).toHaveTextContent("null");
    await expect(
      canvas.getByTestId("listen-audio").getAttribute("src"),
    ).toBeNull();
  },
};

export const KeepsPlayingWhenTheListenerLeavesThePlayer: Story = {
  parameters: { path: `/listen/${UUID}` },
  render: () => (
    <Routes>
      <Route
        path="/listen/:uuid"
        element={
          <>
            <Listen />
            <Link to="/">Leave the player</Link>
          </>
        }
      />
      <Route path="/" element={<MiniDock />} />
    </Routes>
  ),
  play: async ({ canvas }) => {
    await canvas.findByText("Now playing · Chapter 1 of 3");
    const audio = canvas.getByTestId("listen-audio") as HTMLAudioElement;
    await waitFor(() => expect(audio.getAttribute("src")).not.toBeNull());
    const src = audio.getAttribute("src");
    // No media loads here, so the element is made to look like it is playing.
    Object.defineProperty(audio, "paused", { value: false });
    const pause = spyOn(audio, "pause");
    fireEvent.play(audio);
    await canvas.findByRole("button", { name: "Pause" });

    fireEvent.click(canvas.getByRole("link", { name: "Leave the player" }));

    const dock = await dockOf(canvas);
    await expect(dock.getByTestId("mini-dock-title")).toHaveTextContent(
      "Aurora Station, Vol. 1",
    );
    await expect(audio.getAttribute("src")).toBe(src);
    await expect(
      dock.getByRole("button", { name: "Pause" }),
    ).toBeInTheDocument();
    await expect(pause).not.toHaveBeenCalled();
  },
};

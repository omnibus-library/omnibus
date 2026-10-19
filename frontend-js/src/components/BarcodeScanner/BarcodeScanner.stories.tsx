import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, waitFor } from "storybook/test";
import { BarcodeScanner } from "./BarcodeScanner";

const onDetect = fn();
const onManual = fn();
const started: [string, string][] = [];
const torches: boolean[] = [];
const stops = { count: 0 };

/**
 * A stand-in for the vendored glue, which would open a real camera. Its presence also makes
 * `loadScanner` skip the scripts; `then` plays the glue's callbacks once it is started.
 */
function installGlue(then: () => void) {
  window.OmnibusScanner = {
    async start(videoId, { wasmUrl }) {
      started.push([videoId, wasmUrl]);
      then();
    },
    stop() {
      stops.count += 1;
    },
    setTorch(on) {
      torches.push(on);
    },
  };
  return () => {
    delete window.OmnibusScanner;
  };
}

const meta = {
  title: "Components/BarcodeScanner",
  component: BarcodeScanner,
  args: { onDetect, onManual },
  beforeEach() {
    onDetect.mockClear();
    onManual.mockClear();
    started.length = 0;
    torches.length = 0;
    stops.count = 0;
  },
} satisfies Meta<typeof BarcodeScanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = {
  beforeEach: () => installGlue(() => {}),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("barcode-scanner-status"),
    ).toHaveTextContent("Starting camera…");
    await expect(canvas.getByTestId("barcode-scanner-status")).toHaveAttribute(
      "role",
      "status",
    );
    await waitFor(() => expect(started).toHaveLength(1));
    await expect(started[0]?.[0]).toBe("omnibus-scanner-video");
    await expect(started[0]?.[1]).toContain("zxing_reader");
    const stage = canvas
      .getByTestId("barcode-scanner")
      .querySelector(".scanner-stage");
    await expect(stage).toHaveAttribute("data-state", "starting");
    await expect(canvas.getByTestId("barcode-scanner-video")).toHaveAttribute(
      "id",
      "omnibus-scanner-video",
    );
    await expect(canvas.queryByTestId("barcode-scanner-torch")).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Enter ISBN instead" }),
    ).toHaveClass("ghost");
  },
};

export const ReadyWithATorch: Story = {
  beforeEach: () =>
    installGlue(() => {
      window.__omnibusOnScanStatus?.("ready");
      window.__omnibusOnScanTorch?.("1");
    }),
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText(
        "Point the camera at the barcode on the back cover.",
      ),
    ).toBeInTheDocument();
    const torch = await canvas.findByTestId("barcode-scanner-torch");
    await expect(torch).toHaveTextContent("Torch off");
    await expect(torch).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(torch);

    await expect(torch).toHaveTextContent("Torch on");
    await expect(torch).toHaveAttribute("aria-pressed", "true");
    await expect(torches).toEqual([true]);
  },
};

export const ReadyWithoutATorch: Story = {
  beforeEach: () =>
    installGlue(() => {
      window.__omnibusOnScanStatus?.("ready");
      window.__omnibusOnScanTorch?.("0");
    }),
  play: async ({ canvas }) => {
    await canvas.findByText(
      "Point the camera at the barcode on the back cover.",
    );
    await expect(canvas.queryByTestId("barcode-scanner-torch")).toBeNull();
  },
};

const TERMINAL = [
  [
    "Denied",
    "denied",
    "Omnibus can't use the camera. Allow camera access in your settings, or type the ISBN instead.",
  ],
  [
    "Unsupported",
    "unsupported",
    "No camera is available on this device. Type the ISBN instead.",
  ],
  ["Failed", "error", "The scanner couldn't start. Type the ISBN instead."],
] as const;

function terminal(name: string, state: string, message: string): Story {
  return {
    name,
    beforeEach: () =>
      installGlue(() => {
        window.__omnibusOnScanStatus?.(state);
        // A torch the dead camera reported is no use to anyone.
        window.__omnibusOnScanTorch?.("1");
      }),
    play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText(message)).toBeInTheDocument();
      await expect(canvas.queryByTestId("barcode-scanner-torch")).toBeNull();
      const stage = canvas
        .getByTestId("barcode-scanner")
        .querySelector(".scanner-stage");
      await expect(stage).toHaveAttribute("data-state", "off");
      const manual = canvas.getByRole("button", { name: "Enter ISBN instead" });
      await expect(manual).toHaveClass("primary");
      await userEvent.click(manual);
      await expect(onManual).toHaveBeenCalledTimes(1);
    },
  };
}

export const Denied: Story = terminal(...TERMINAL[0]);
export const Unsupported: Story = terminal(...TERMINAL[1]);
export const Failed: Story = terminal(...TERMINAL[2]);

export const ReportsADetectionOnce: Story = {
  beforeEach: () =>
    installGlue(() => {
      window.__omnibusOnScanStatus?.("ready");
      window.__omnibusOnScanResult?.("9780134685991");
    }),
  play: async ({ canvas }) => {
    await canvas.findByText(
      "Point the camera at the barcode on the back cover.",
    );
    await waitFor(() => expect(onDetect).toHaveBeenCalledWith("9780134685991"));
    await expect(onDetect).toHaveBeenCalledTimes(1);
  },
};

export const ReleasesTheCameraWhenItLeaves: Story = {
  render: (args) => {
    const [shown, setShown] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setShown(false)}>
          Leave
        </button>
        {shown && <BarcodeScanner {...args} />}
      </>
    );
  },
  beforeEach: () => installGlue(() => {}),
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(started).toHaveLength(1));
    await expect(typeof window.__omnibusOnScanResult).toBe("function");

    await userEvent.click(canvas.getByRole("button", { name: "Leave" }));

    await expect(stops.count).toBe(1);
    await expect(window.__omnibusOnScanStatus).toBeUndefined();
    await expect(window.__omnibusOnScanTorch).toBeUndefined();
    await expect(window.__omnibusOnScanResult).toBeUndefined();
  },
};

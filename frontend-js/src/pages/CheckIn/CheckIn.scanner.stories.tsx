import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import {
  type Ctx,
  handlers,
  ISBN,
  Page,
  resetCheckIn,
  resolved,
} from "./CheckIn.stories.shared";

const meta = {
  title: "Pages/CheckIn/Scanner",
  component: Page,
  parameters: { path: "/check-in" },
  beforeEach: resetCheckIn,
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A stand-in for the vendored glue, which would open a real camera; `then` plays its callbacks once started. */
function fakeCamera(then: () => void) {
  window.OmnibusScanner = {
    async start() {
      then();
    },
    stop() {},
    setTorch() {},
  };
  return () => {
    delete window.OmnibusScanner;
  };
}

const ready = () => window.__omnibusOnScanStatus?.("ready");

/** Presses "Scan a barcode" on the lookup. */
async function openScanner({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.click(await canvas.findByTestId("check-in-scan-instead"));
}

export const LookupLoadsNoScanner: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("check-in-lookup");
    await expect(
      document.head.querySelectorAll(
        'script[src*="zxing"], script[src*="barcode-scanner"]',
      ),
    ).toHaveLength(0);
    await expect(canvas.queryByTestId("barcode-scanner")).toBeNull();
  },
};

export const ScanBarcodeOpensTheScanner: Story = {
  beforeEach: () => fakeCamera(ready),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");

    const screen = canvas.getByTestId("check-in-scan");
    await expect(screen).toHaveTextContent("Scan a barcode");
    await expect(screen).toHaveTextContent(
      "Hold the back cover in the frame — we'll read the ISBN automatically.",
    );
    await expect(
      await canvas.findByTestId("barcode-scanner-status"),
    ).toHaveTextContent("Point the camera at the barcode on the back cover.");
    await expect(
      canvas.getByTestId("check-in-search-by-title"),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("check-in-search-by-title"));
    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
  },
};

export const ADetectionResolvesAsScanned: Story = {
  beforeEach: () =>
    fakeCamera(() => {
      ready();
      window.__omnibusOnScanResult?.(ISBN);
    }),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`Scanned ISBN ${ISBN}`);
    await expect(resolved).toEqual([ISBN]);
  },
};

export const ARejectedDecodeLandsOnTheKeypadWithTheDigits: Story = {
  beforeEach: () =>
    fakeCamera(() => {
      ready();
      window.__omnibusOnScanResult?.("9780134685992");
    }),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-entry"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(
      "9780134685992",
    );
    await expect(canvas.getByTestId("check-in-error")).toHaveTextContent(
      "ISBN has an invalid check digit",
    );
    await expect(resolved).toEqual([]);
  },
};

export const AFailedScanLookupLandsOnTheKeypad: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...handlers(
        { kind: "unresolved" },
        { refuse: { resolve: "providers are down" } },
      ),
    );
    return fakeCamera(() => {
      ready();
      window.__omnibusOnScanResult?.(ISBN);
    });
  },
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });

    await expect(
      await canvas.findByTestId("check-in-entry"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("check-in-error")).toHaveTextContent(
      "Could not look that up: providers are down",
    );
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(ISBN);
  },
};

export const TheCameraDeniedOffersTheKeypad: Story = {
  beforeEach: () => fakeCamera(() => window.__omnibusOnScanStatus?.("denied")),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");
    await userEvent.click(await canvas.findByTestId("barcode-scanner-manual"));

    await expect(
      await canvas.findByTestId("check-in-entry"),
    ).toBeInTheDocument();
  },
};

export const KeypadBuildsAnIsbnKeyByKey: Story = {
  beforeEach: () => fakeCamera(() => window.__omnibusOnScanStatus?.("denied")),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");
    await userEvent.click(await canvas.findByTestId("barcode-scanner-manual"));
    const screen = await canvas.findByTestId("check-in-entry");
    await expect(screen).toHaveTextContent("Enter the ISBN");
    await expect(screen).toHaveTextContent(
      "It's the 13-digit number under the barcode on the back cover.",
    );
    const progress = canvas.getByTestId("check-in-isbn-progress");
    await expect(progress.querySelectorAll(".isbn-slot")).toHaveLength(13);
    const submit = canvas.getByTestId("check-in-submit");

    for (const key of ISBN.slice(0, 12)) {
      await userEvent.click(canvas.getByTestId(`check-in-key-${key}`));
    }
    await expect(progress).toHaveAttribute("data-filled", "12");
    await expect(progress.querySelectorAll(".isbn-slot.filled")).toHaveLength(
      12,
    );
    await expect(submit).toBeDisabled();

    await userEvent.click(canvas.getByTestId("check-in-key-2"));
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    await userEvent.click(canvas.getByTestId("check-in-key-1"));
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(ISBN);
    await expect(submit).toBeEnabled();

    // A thirteenth slot is the last one.
    await userEvent.click(canvas.getByTestId("check-in-key-7"));
    await expect(canvas.getByTestId("check-in-isbn")).toHaveValue(ISBN);
    await expect(progress).toHaveAttribute("data-filled", "13");

    await userEvent.click(submit);
    await expect(
      await canvas.findByTestId("check-in-confirm"),
    ).toHaveTextContent(`Entered ISBN ${ISBN}`);
    await expect(resolved).toEqual([ISBN]);
  },
};

export const KeypadGoesBackToTheScannerOrToTitleSearch: Story = {
  beforeEach: () => fakeCamera(() => window.__omnibusOnScanStatus?.("denied")),
  play: async ({ canvas, userEvent }) => {
    await openScanner({ canvas, userEvent });
    await canvas.findByTestId("check-in-scan");
    await userEvent.click(await canvas.findByTestId("barcode-scanner-manual"));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Scan a barcode instead" }),
    );
    await expect(
      await canvas.findByTestId("check-in-scan"),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("barcode-scanner-manual"));
    await userEvent.click(
      await canvas.findByTestId("check-in-search-by-title"),
    );
    await expect(
      await canvas.findByTestId("check-in-lookup"),
    ).toBeInTheDocument();
  },
};

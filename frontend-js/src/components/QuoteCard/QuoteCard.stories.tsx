import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, spyOn, waitFor, within } from "storybook/test";
import { parseBookUuid } from "../../api";
import { failing, hanging } from "../../testing/handlers";
import { QuoteCard } from "./QuoteCard";
import { drawQuoteCanvas } from "./quoteCanvas";
import { hexToOklch } from "./quoteColor";

const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");
if (!UUID) throw new Error("fixture uuid");
const PALETTE = "/api/books/:uuid/cover/palette";

const meta = {
  title: "Components/QuoteCard",
  component: QuoteCard,
  args: {
    text: "The Beauty of the House is immeasurable",
    author: "Susanna Clarke",
    subtitle: "Piranesi",
    uuid: UUID,
    accent: "oklch(0.40 0.08 150)",
    onClose: fn(),
  },
  beforeEach() {
    // The canvas waits on a Google Fonts fetch, and a cold one outlasts the stories' waits.
    const load = spyOn(document.fonts, "load").mockResolvedValue([]);
    return () => load.mockRestore();
  },
} satisfies Meta<typeof QuoteCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const pixel = (canvas: HTMLCanvasElement, x: number, y: number) =>
  [...(canvas.getContext("2d")?.getImageData(x, y, 1, 1).data ?? [])].slice(
    0,
    3,
  );

const hexAt = (canvas: HTMLCanvasElement, x: number, y: number) =>
  `#${pixel(canvas, x, y)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;

// The card's top-left corner, where the wash is at its first stop.
const cornerLightness = (canvas: HTMLCanvasElement) =>
  hexToOklch(hexAt(canvas, 2, 2)).l;

const near = (actual: number[], expected: number[], tolerance = 2) =>
  actual.every((v, i) => Math.abs(v - (expected[i] ?? 0)) <= tolerance);

const pressed = (name: string) => ({ name, pressed: true });

export const Preview: Story = {
  play: async ({ canvas }) => {
    const preview = canvas.getByTestId("quote-preview") as HTMLCanvasElement;
    await expect([preview.width, preview.height]).toEqual([1080, 1080]);
    // Opens on the book's own tone: its accent held to a band the ink reads on.
    await waitFor(() => {
      const corner = hexToOklch(hexAt(preview, 2, 2));
      expect(corner.l).toBeCloseTo(0.4, 1);
      expect(corner.h).toBeCloseTo(150, -1);
    });
    await expect(canvas.getByTestId("quote-preview-body")).toHaveTextContent(
      /^The Beauty of the House is immeasurable$/,
    );
    await expect(canvas.getByText("Susanna Clarke")).toBeInTheDocument();
    await expect(canvas.getByText("Piranesi")).toBeInTheDocument();
    // Solid · Book, Serif, M, upright, Square.
    for (const name of ["Book", "Serif", "M", "Square 1:1"]) {
      await expect(canvas.getByRole("button", pressed(name))).toBeVisible();
    }
    for (const name of ["Bold", "Italic"]) {
      await expect(canvas.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  },
};

export const SolidSwatches: Story = {
  play: async ({ canvas, userEvent }) => {
    const preview = canvas.getByTestId("quote-preview") as HTMLCanvasElement;

    await userEvent.click(canvas.getByRole("button", { name: "Paper" }));
    await expect(canvas.getByRole("button", pressed("Paper"))).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Book" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() => expect(cornerLightness(preview)).toBeCloseTo(0.93, 1));

    await userEvent.click(canvas.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(cornerLightness(preview)).toBeCloseTo(0.4, 1));

    fireEvent.change(canvas.getByLabelText("Custom background color"), {
      target: { value: "#ffffff" },
    });
    await waitFor(() =>
      expect(near(pixel(preview, 2, 2), [255, 255, 255])).toBe(true),
    );
    for (const name of ["Book", "Paper"]) {
      await expect(canvas.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  },
};

// Opens the Background menu and chooses a kind.
async function chooseKind(
  canvas: ReturnType<typeof within>,
  userEvent: { click: (el: Element) => Promise<void> },
  kind: "Solid" | "Gradient",
) {
  await userEvent.click(
    canvas.getByRole("button", { name: /^(Solid|Gradient)$/ }),
  );
  await userEvent.click(canvas.getByRole("menuitemradio", { name: kind }));
}

const gradients = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByRole("group", { name: "Gradient backgrounds" }));

export const BackgroundMenuSwitchesTheRow: Story = {
  play: async ({ canvas, userEvent }) => {
    const pill = canvas.getByRole("button", { name: "Solid" });
    await expect(pill).toHaveAttribute("aria-haspopup", "menu");
    await userEvent.click(pill);
    await expect(
      canvas.getByRole("menuitemradio", { name: "Solid" }),
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.click(
      canvas.getByRole("menuitemradio", { name: "Gradient" }),
    );

    await expect(
      canvas.getByRole("button", { name: "Gradient" }),
    ).toBeVisible();
    const row = gradients(canvas);
    await expect(
      await row.findAllByRole("button", { name: /^Cover gradient \d$/ }),
    ).toHaveLength(4);
    await expect(
      canvas.getByTestId("quote-gradient-divider"),
    ).toBeInTheDocument();
    for (const name of ["Ember", "Dusk", "Lagoon", "Grove", "Dawn"]) {
      await expect(row.getByRole("button", { name })).toBeVisible();
    }
    await expect(
      row.getByRole("button", pressed("Cover gradient 1")),
    ).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Gradient" }));
    await expect(
      canvas.getByRole("menuitemradio", { name: "Gradient" }),
    ).toHaveAttribute("aria-checked", "true");
  },
};

export const GradientPresetRepaints: Story = {
  play: async ({ canvas, userEvent }) => {
    const preview = canvas.getByTestId("quote-preview") as HTMLCanvasElement;
    await chooseKind(canvas, userEvent, "Gradient");

    await userEvent.click(
      gradients(canvas).getByRole("button", { name: "Dawn" }),
    );

    await expect(
      gradients(canvas).getByRole("button", pressed("Dawn")),
    ).toBeVisible();
    await waitFor(() =>
      expect(near(pixel(preview, 2, 2), [0xf7, 0xe1, 0xc8])).toBe(true),
    );
  },
};

export const CoverPairsAbsentOnError: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", PALETTE, 404));
  },
  play: async ({ canvas, userEvent }) => {
    await chooseKind(canvas, userEvent, "Gradient");

    await waitFor(() =>
      expect(
        canvas.queryByTestId("quote-cover-pending"),
      ).not.toBeInTheDocument(),
    );
    await expect(
      canvas.queryAllByRole("button", { name: /^Cover gradient/ }),
    ).toHaveLength(0);
    await expect(
      canvas.queryByTestId("quote-gradient-divider"),
    ).not.toBeInTheDocument();
    // With no cover pair to start on, the Gradient kind starts on Ember.
    await expect(
      gradients(canvas).getByRole("button", pressed("Ember")),
    ).toBeVisible();
  },
};

export const CoverPairsWaitWithASkeleton: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(PALETTE));
  },
  play: async ({ canvas, userEvent }) => {
    await chooseKind(canvas, userEvent, "Gradient");

    await expect(canvas.getByTestId("quote-cover-pending")).toBeInTheDocument();
    await expect(
      canvas.queryAllByRole("button", { name: /^Cover gradient/ }),
    ).toHaveLength(0);
    await expect(
      canvas.queryByTestId("quote-gradient-divider"),
    ).not.toBeInTheDocument();
  },
};

export const CustomGradient: Story = {
  play: async ({ canvas, userEvent }) => {
    const preview = canvas.getByTestId("quote-preview") as HTMLCanvasElement;
    await chooseKind(canvas, userEvent, "Gradient");

    await userEvent.click(
      canvas.getByRole("button", { name: "Custom gradient" }),
    );

    await expect(canvas.getByLabelText("From")).toHaveValue("#e8735a");
    await expect(canvas.getByLabelText("To")).toHaveValue("#2a8c8c");
    await expect(canvas.getByText("#e8735a")).toBeVisible();
    await expect(canvas.getByText("#2a8c8c")).toBeVisible();
    fireEvent.change(canvas.getByLabelText("From"), {
      target: { value: "#000000" },
    });
    fireEvent.change(canvas.getByLabelText("To"), {
      target: { value: "#ffffff" },
    });
    // Corner to corner at 135°, the far top corner sits mid-way between the stops.
    await waitFor(() =>
      expect(near(pixel(preview, 2, 2), [0, 0, 0], 3)).toBe(true),
    );
    await waitFor(() =>
      expect(near(pixel(preview, 1077, 2), [128, 128, 128], 6)).toBe(true),
    );

    await userEvent.click(canvas.getByRole("button", { name: /Rotate/ }));

    // A quarter-turn on, the gradient runs top to bottom and the top edge is all the first stop.
    await waitFor(() =>
      expect(near(pixel(preview, 1077, 2), [0, 0, 0], 3)).toBe(true),
    );
  },
};

export const Typography: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Mono" }));
    await userEvent.click(canvas.getByRole("button", { name: "L" }));
    await userEvent.click(canvas.getByRole("button", { name: "Bold" }));
    await userEvent.click(canvas.getByRole("button", { name: "Italic" }));

    for (const name of ["Mono", "L", "Bold", "Italic"]) {
      await expect(canvas.getByRole("button", pressed(name))).toBeVisible();
    }
    for (const name of ["Serif", "M"]) {
      await expect(canvas.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }

    await userEvent.click(canvas.getByRole("button", { name: "Italic" }));
    await expect(
      canvas.getByRole("button", { name: "Italic" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};

export const Shapes: Story = {
  play: async ({ canvas, userEvent }) => {
    const preview = canvas.getByTestId("quote-preview") as HTMLCanvasElement;

    await userEvent.click(canvas.getByRole("button", { name: "Story 9:16" }));

    await expect([preview.width, preview.height]).toEqual([1080, 1920]);
    await expect(
      canvas.getByRole("button", pressed("Story 9:16")),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Square 1:1" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};

export const Closes: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Close" }));

    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

const WASH = { from: "#102030", to: "#a0b0c0", ink: "#f5f0e8" };

const drawing = (overrides: Partial<Parameters<typeof drawQuoteCanvas>[0]>) =>
  ({
    text: "The Beauty of the House is immeasurable",
    author: "Susanna Clarke",
    subtitle: "Piranesi",
    wash: WASH,
    ratio: "4:5",
    font: "serif",
    size: "m",
    bold: false,
    italic: false,
    ...overrides,
  }) as const;

export const DrawsTheCanvas: Story = {
  play: async () => {
    const canvas = (await drawQuoteCanvas(drawing({}))) as HTMLCanvasElement;

    await expect([canvas.width, canvas.height]).toEqual([1080, 1350]);
    await expect(near(pixel(canvas, 2, 2), [0x10, 0x20, 0x30])).toBe(true);
    await expect(near(pixel(canvas, 1077, 1347), [0xa0, 0xb0, 0xc0])).toBe(
      true,
    );
  },
};

// The pixels of `rows` full-width rows down from `top`.
const bytes = (canvas: HTMLCanvasElement, top: number, rows: number) =>
  Array.from(
    canvas.getContext("2d")?.getImageData(0, top, 1080, rows).data ?? [],
  );

export const KeepsALongPassageAboveTheFooter: Story = {
  play: async () => {
    const long = "A long, long passage that keeps on going. ".repeat(60);
    const withText = (await drawQuoteCanvas(
      drawing({ text: long, ratio: "9:16" }),
    )) as HTMLCanvasElement;
    const without = (await drawQuoteCanvas(
      drawing({ text: "", ratio: "9:16" }),
    )) as HTMLCanvasElement;

    // The bottom padding holds no ink either way, so the clamp kept the text out of it.
    await expect(bytes(withText, 1840, 40)).toEqual(bytes(without, 1840, 40));
    // And the gap above the footer's rule stays clear.
    await expect(bytes(withText, 1655, 25)).toEqual(bytes(without, 1655, 25));
    // The passage did draw: the middle of the card differs from the empty one.
    await expect(bytes(withText, 300, 1000)).not.toEqual(
      bytes(without, 300, 1000),
    );
  },
};

const clicked: HTMLAnchorElement[] = [];

// Records the links the page clicks instead of letting the browser download them.
function recordLinkClicks() {
  clicked.length = 0;
  return spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clicked.push(this);
    },
  );
}

// The real clipboard needs a focused document, which a test page isn't.
function stubClipboard(write: () => Promise<void>) {
  const original = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", {
    value: { write: fn(write) },
    configurable: true,
  });
  return () =>
    Object.defineProperty(navigator, "clipboard", {
      value: original,
      configurable: true,
    });
}

export const Downloads: Story = {
  beforeEach() {
    const click = recordLinkClicks();
    return () => click.mockRestore();
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("quote-download"));

    await waitFor(() => expect(clicked).toHaveLength(1));
    await expect(clicked[0]?.download).toBe("omnibus-quote.png");
    await expect(clicked[0]?.href).toMatch(/^blob:/);
  },
};

export const CopiesTheImage: Story = {
  beforeEach() {
    return stubClipboard(async () => {});
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("quote-copy-image"));

    await waitFor(() =>
      expect(navigator.clipboard.write).toHaveBeenCalledWith([
        expect.any(ClipboardItem),
      ]),
    );
  },
};

export const CopyFallsBackToADownload: Story = {
  beforeEach() {
    const restoreClipboard = stubClipboard(() =>
      Promise.reject(new Error("refused")),
    );
    const click = recordLinkClicks();
    return () => {
      click.mockRestore();
      restoreClipboard();
    };
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("quote-copy-image"));

    await waitFor(() => expect(clicked).toHaveLength(1));
    await expect(clicked[0]?.download).toBe("omnibus-quote.png");
  },
};

export const SharesTheImage: Story = {
  beforeEach() {
    const share = fn(async () => {});
    Object.defineProperty(navigator, "canShare", {
      value: () => true,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    return () => {
      Reflect.deleteProperty(navigator, "canShare");
      Reflect.deleteProperty(navigator, "share");
    };
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("quote-share"));

    await waitFor(() => expect(navigator.share).toHaveBeenCalledOnce());
    await expect(navigator.share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Piranesi",
        files: [
          expect.objectContaining({
            name: "omnibus-quote.png",
            type: "image/png",
          }),
        ],
      }),
    );
  },
};

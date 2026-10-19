import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, spyOn, waitFor } from "storybook/test";
import { QuoteCard } from "./QuoteCard";
import { drawQuoteCanvas } from "./quoteCanvas";

const meta = {
  title: "Components/QuoteCard",
  component: QuoteCard,
  args: {
    text: "The Beauty of the House is immeasurable",
    author: "Susanna Clarke",
    subtitle: "Piranesi",
    accent: "#3a3027",
    onClose: fn(),
  },
} satisfies Meta<typeof QuoteCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Preview: Story = {
  play: async ({ canvas }) => {
    const preview = canvas.getByTestId("quote-preview");
    const body = canvas.getByTestId("quote-preview-body");
    await expect(body).toHaveTextContent(
      "“The Beauty of the House is immeasurable”",
    );
    await expect(canvas.getByText("Susanna Clarke")).toBeInTheDocument();
    await expect(canvas.getByText("Piranesi")).toBeInTheDocument();
    // Opens as the designed default: the accent, a medium serif italic, square.
    await expect(preview).toHaveStyle({
      backgroundColor: "rgb(58, 48, 39)",
      color: "rgb(245, 240, 232)",
    });
    await expect(preview.style.fontFamily).toBe("var(--serif)");
    await expect(body).toHaveStyle({
      fontSize: "22px",
      fontWeight: "400",
      fontStyle: "italic",
    });
    await expect(canvas.getByRole("button", { name: "1:1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};

export const Backgrounds: Story = {
  play: async ({ canvas, userEvent }) => {
    const preview = canvas.getByTestId("quote-preview");

    await userEvent.click(
      canvas.getByRole("button", { name: "Background #f0ece2" }),
    );
    await expect(preview).toHaveStyle({
      backgroundColor: "rgb(240, 236, 226)",
      color: "rgb(42, 37, 32)",
    });

    await userEvent.click(canvas.getByRole("button", { name: "Book accent" }));
    await expect(preview).toHaveStyle({
      backgroundColor: "rgb(58, 48, 39)",
      color: "rgb(245, 240, 232)",
    });

    fireEvent.change(canvas.getByLabelText("Custom background color"), {
      target: { value: "#ffffff" },
    });
    await expect(preview).toHaveStyle({
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(34, 29, 24)",
    });
  },
};

export const Typography: Story = {
  play: async ({ canvas, userEvent }) => {
    const body = canvas.getByTestId("quote-preview-body");

    await userEvent.click(canvas.getByRole("button", { name: "Mono" }));
    await expect(canvas.getByTestId("quote-preview").style.fontFamily).toBe(
      "var(--mono)",
    );
    await expect(canvas.getByRole("button", { name: "Mono" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("button", { name: "Serif" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await userEvent.click(canvas.getByRole("button", { name: "L" }));
    await expect(body).toHaveStyle({ fontSize: "27px" });

    await userEvent.click(canvas.getByRole("button", { name: "Bold" }));
    await userEvent.click(canvas.getByRole("button", { name: "Italic" }));
    await expect(body).toHaveStyle({ fontWeight: "700", fontStyle: "normal" });
    await expect(canvas.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      canvas.getByRole("button", { name: "Italic" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};

export const AspectRatio: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "9:16" }));

    await expect(canvas.getByTestId("quote-preview").style.aspectRatio).toBe(
      "9 / 16",
    );
    await expect(canvas.getByRole("button", { name: "9:16" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("button", { name: "1:1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  },
};

export const Closes: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Close" }));

    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

const pixel = (canvas: HTMLCanvasElement, x: number, y: number) =>
  [...(canvas.getContext("2d")?.getImageData(x, y, 1, 1).data ?? [])].slice(
    0,
    3,
  );

export const DrawsTheCanvas: Story = {
  play: async ({ args }) => {
    const card = {
      text: args.text,
      author: args.author,
      subtitle: args.subtitle,
      bg: "#3a3027",
      ink: "#f5f0e8",
      ratio: "4:5",
      font: "serif",
      size: "m",
      bold: false,
      italic: true,
    } as const;

    const canvas = await drawQuoteCanvas(card);

    await expect([canvas?.width, canvas?.height]).toEqual([1080, 1350]);
    await expect(pixel(canvas as HTMLCanvasElement, 2, 2)).toEqual([
      0x3a, 0x30, 0x27,
    ]);
    // The attribution rule: 1350 - 108 padding - 65 footer offset - 22 above it.
    await expect(pixel(canvas as HTMLCanvasElement, 540, 1155)).not.toEqual([
      0x3a, 0x30, 0x27,
    ]);
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

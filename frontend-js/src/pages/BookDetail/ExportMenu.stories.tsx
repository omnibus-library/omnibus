import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { kindleHandlers } from "../../testing/handlers";
import { aWireBook, aWireFile } from "../../testing/wire";
import { ExportMenu } from "./ExportMenu";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const EPUB = aWireFile({ id: 11, format: "EPUB" });
const PDF = aWireFile({ id: 12, format: "PDF" });
const AUDIO = aWireFile({ id: 21, format: "M4B" });

function aBook(
  formats: string[],
  files: ReturnType<typeof aWireFile>[],
  epubSizeBytes = 3_100_000,
) {
  return toBookDetail(
    aWireBook({ formats, book_files: files, epub_size_bytes: epubSizeBytes }),
  );
}

const sent: { book_uuid: string; file_id?: number | null }[] = [];

const meta = {
  title: "Pages/BookDetail/ExportMenu",
  component: ExportMenu,
  args: { book: aBook(["EPUB", "M4B"], [EPUB, AUDIO]) },
  beforeEach({ msw }) {
    sent.length = 0;
    msw.use(...kindleHandlers(["pending", "sent"], sent));
  },
} satisfies Meta<typeof ExportMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClosedUntilOpened: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /Export/ });
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(trigger);

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = canvas.getByRole("dialog", { name: "Export options" });
    await waitFor(() => expect(panel).toHaveFocus());
  },
};

export const EbookAndAudiobookOfferEverything: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));
    const panel = within(canvas.getByRole("dialog"));

    await expect(
      panel.getByRole("link", { name: "Download EPUB" }),
    ).toHaveAttribute("href", `/api/ebooks/${UUID}/download`);
    await expect(
      panel.getByRole("link", { name: "Download audiobook" }),
    ).toHaveAttribute("href", `/api/audiobooks/${UUID}/download`);
    await expect(
      panel.getByRole("button", { name: "Send to Kindle" }),
    ).toBeInTheDocument();
    await expect(
      panel.getByRole("link", { name: "Send to Kobo" }),
    ).toHaveAttribute("href", `/api/ebooks/${UUID}/kepub`);
  },
};

export const PdfOffersItsDownloadAndKindleOnly: Story = {
  args: { book: aBook(["PDF"], [PDF]) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));
    const panel = within(canvas.getByRole("dialog"));

    await expect(
      panel.getByRole("link", { name: "Download PDF" }),
    ).toBeInTheDocument();
    await expect(
      panel.getByRole("button", { name: "Send to Kindle" }),
    ).toBeInTheDocument();
    await expect(
      panel.queryByRole("link", { name: "Send to Kobo" }),
    ).not.toBeInTheDocument();
  },
};

export const AudiobookOffersOnlyItsDownload: Story = {
  args: { book: aBook(["M4B"], [AUDIO]) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));
    const panel = within(canvas.getByRole("dialog"));

    await expect(
      panel.getByRole("link", { name: "Download audiobook" }),
    ).toBeInTheDocument();
    await expect(
      panel.queryByRole("link", { name: "Download EPUB" }),
    ).not.toBeInTheDocument();
    await expect(
      panel.queryByRole("button", { name: "Send to Kindle" }),
    ).not.toBeInTheDocument();
  },
};

export const EscapeClosesIt: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));
    const panel = canvas.getByRole("dialog");
    await waitFor(() => expect(panel).toHaveFocus());

    await userEvent.keyboard("{Escape}");

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const ScrimClosesIt: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));
    await userEvent.click(canvas.getByTestId("hero-export-scrim"));
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const ADownloadClosesIt: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));
    // The click would navigate to the file; only the menu's reaction is under test.
    const link = canvas.getByRole("link", { name: "Download EPUB" });
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(link);
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const SendToKindleKeepsTheMenuOpenAndReports: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));

    await userEvent.click(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    );

    await expect(
      canvas.getByRole("button", { name: "Sending…" }),
    ).toBeDisabled();
    await expect(
      await canvas.findByTestId("kindle-send-status", {}, { timeout: 4000 }),
    ).toHaveTextContent("Sent to your Kindle.");
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
    await expect(sent).toEqual([{ book_uuid: UUID, file_id: null }]);
  },
};

export const OversizeEpubPointsToAmazonsUploader: Story = {
  args: { book: aBook(["EPUB"], [EPUB], 50_000_001) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Export/ }));

    await expect(
      canvas.queryByRole("button", { name: "Send to Kindle" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByTestId("hero-send-kindle-oversize"),
    ).toHaveAttribute("aria-disabled", "true");
    const note = canvas.getByTestId("hero-send-kindle-web-link");
    await expect(note).toHaveAttribute(
      "href",
      "https://www.amazon.com/sendtokindle",
    );
    await expect(note).toHaveTextContent("Too large to email.");
  },
};

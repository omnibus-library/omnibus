import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { failing, kindleHandlers } from "../../testing/handlers";
import { aWireBook, aWireFile } from "../../testing/wire";
import { FormatSwitcher } from "./FormatSwitcher";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

function props(
  formats: string[],
  files: Parameters<typeof aWireFile>[0][],
  epubSizeBytes = 3_100_000,
) {
  const book = toBookDetail(
    aWireBook({
      formats,
      book_files: files.map(aWireFile),
      epub_size_bytes: epubSizeBytes,
    }),
  );
  return {
    uuid: book.uuid,
    formats: book.formats,
    files: book.bookFiles,
    epubSizeBytes: book.epubSizeBytes,
  };
}

function Leavable(args: Parameters<typeof FormatSwitcher>[0]) {
  const [here, setHere] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setHere(false)}>
        Leave
      </button>
      {here && <FormatSwitcher {...args} />}
    </>
  );
}

const meta = {
  title: "Components/FormatSwitcher",
  component: FormatSwitcher,
  args: props(["EPUB"], [{ id: 11, format: "EPUB" }]),
} satisfies Meta<typeof FormatSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneFormat: Story = {
  play: async ({ canvas }) => {
    const group = canvas.getByRole("group", { name: "Available formats" });
    await expect(within(group).getByText("Ebook")).toBeInTheDocument();
    await expect(within(group).getByText("EPUB · 3.0 MB")).toBeInTheDocument();
    await expect(
      within(group).getByRole("link", { name: "Read" }),
    ).toHaveAttribute("href", `/read/${UUID}`);
  },
};

export const SeveralFormats: Story = {
  args: props(
    ["M4B", "PDF", "EPUB", "cbz"],
    [
      { id: 11, format: "EPUB" },
      { id: 12, format: "PDF" },
      { id: 21, format: "M4B", size_bytes: 806_000_000 },
    ],
  ),
  play: async ({ canvas }) => {
    const rows = canvas
      .getAllByTestId(/^format-row-/)
      .map((row) => row.dataset.format);
    await expect(rows).toEqual(["cbz", "EPUB", "M4B", "PDF"]);
    await expect(canvas.getByRole("link", { name: "Listen" })).toHaveAttribute(
      "href",
      `/listen/${UUID}`,
    );
    await expect(
      within(canvas.getByTestId("format-row-pdf")).getByRole("link", {
        name: "Read",
      }),
    ).toHaveAttribute("href", `/pdf/${UUID}`);
    await expect(
      within(canvas.getByTestId("format-row-cbz")).getByText("No actions yet"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("M4B · 768.7 MB")).toBeInTheDocument();
  },
};

export const SeveralFilesOfOneFormat: Story = {
  args: props(
    ["EPUB"],
    [
      { id: 11, format: "EPUB", label: "First edition" },
      { id: 12, format: "EPUB", ordinal: 1 },
    ],
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("EPUB · 2 editions")).toBeInTheDocument();
    await expect(
      within(canvas.getByTestId("format-file-11")).getByText("First edition"),
    ).toBeInTheDocument();
    await expect(
      within(canvas.getByTestId("format-file-12")).getByText("Part 2"),
    ).toBeInTheDocument();
    await expect(
      within(canvas.getByTestId("format-file-12")).getByRole("link", {
        name: "Read",
      }),
    ).toHaveAttribute("href", `/read/${UUID}?file_id=12`);
  },
};

export const ShowsTheFilenameSizeAndDuration: Story = {
  args: props(
    ["EPUB", "M4B"],
    [
      {
        id: 11,
        format: "EPUB",
        filename: "Aurora Station - Sora Inkwell.epub",
      },
      {
        id: 21,
        format: "M4B",
        filename: "Aurora Station - Sora Inkwell.m4b",
        size_bytes: 7_864_320,
        duration_seconds: 39_840,
      },
    ],
  ),
  play: async ({ canvas }) => {
    const ebook = within(canvas.getByTestId("format-row-epub"));
    await expect(ebook.getByText("EPUB · 3.0 MB")).toBeInTheDocument();
    await expect(ebook.getByTestId("format-filename")).toHaveTextContent(
      "Aurora Station - Sora Inkwell.epub",
    );

    // The audiobook adds its playing time.
    const audio = within(canvas.getByTestId("format-row-m4b"));
    await expect(
      audio.getByText("M4B · 7.5 MB · 11 h 4 m"),
    ).toBeInTheDocument();
    await expect(audio.getByTestId("format-filename")).toHaveTextContent(
      "Aurora Station - Sora Inkwell.m4b",
    );
  },
};

export const EachFileOfSeveralShowsItsFilenameAndSize: Story = {
  args: props(
    ["EPUB"],
    [
      {
        id: 11,
        format: "EPUB",
        label: "First edition",
        filename: "first.epub",
      },
      {
        id: 12,
        format: "EPUB",
        ordinal: 1,
        filename: "second.epub",
        size_bytes: 1_572_864,
      },
    ],
  ),
  play: async ({ canvas }) => {
    const first = within(canvas.getByTestId("format-file-11"));
    await expect(first.getByTestId("format-facts")).toHaveTextContent("3.0 MB");
    await expect(first.getByTestId("format-filename")).toHaveTextContent(
      "first.epub",
    );
    const second = within(canvas.getByTestId("format-file-12"));
    await expect(second.getByTestId("format-facts")).toHaveTextContent(
      "1.5 MB",
    );
    await expect(second.getByTestId("format-filename")).toHaveTextContent(
      "second.epub",
    );
  },
};

export const NoFormats: Story = {
  args: props([], []),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("group")).not.toBeInTheDocument();
  },
};

const sent: { book_uuid: string; file_id?: number | null }[] = [];
const polls = { count: 0 };

function kindle(
  ...answers: Parameters<typeof kindleHandlers>[0]
): Story["beforeEach"] {
  return ({ msw }) => {
    sent.length = 0;
    polls.count = 0;
    msw.use(...kindleHandlers(answers, sent, polls));
  };
}

export const EpubOffersReadKindleAndKobo: Story = {
  play: async ({ canvas }) => {
    const row = within(canvas.getByTestId("format-row-epub"));
    await expect(row.getByRole("link", { name: "Read" })).toBeInTheDocument();
    await expect(
      row.getByRole("button", { name: "Send to Kindle" }),
    ).toBeInTheDocument();
    await expect(
      row.getByRole("link", { name: "Send to Kobo" }),
    ).toHaveAttribute("href", `/api/ebooks/${UUID}/kepub`);
  },
};

export const PdfOffersKindleButNotKobo: Story = {
  args: props(["PDF"], [{ id: 12, format: "PDF" }]),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Send to Kobo" }),
    ).not.toBeInTheDocument();
  },
};

export const AudioOffersNeither: Story = {
  args: props(["M4B"], [{ id: 21, format: "M4B" }]),
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: "Send to Kindle" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Send to Kobo" }),
    ).not.toBeInTheDocument();
  },
};

export const MultiFileEpubKeepsKoboOnTheRowAndKindleOnEachFile: Story = {
  args: props(
    ["EPUB"],
    [
      { id: 11, format: "EPUB", label: "First edition" },
      { id: 12, format: "EPUB", ordinal: 1 },
    ],
  ),
  beforeEach: kindle("sent"),
  play: async ({ canvas, userEvent }) => {
    const row = within(canvas.getByTestId("format-row-epub"));
    await expect(
      row.getByRole("link", { name: "Send to Kobo" }),
    ).toBeInTheDocument();
    await expect(
      row.queryByRole("button", { name: "Send to Kindle" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(canvas.getByTestId("format-file-12")).getByRole("button", {
        name: "Send to Kindle",
      }),
    );

    await waitFor(() =>
      expect(sent).toEqual([{ book_uuid: UUID, file_id: 12 }]),
    );
  },
};

export const KindleSendsThenSaysSoAndClearsItself: Story = {
  beforeEach: kindle("pending", "sent"),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    );

    const busy = canvas.getByRole("button", { name: "Sending…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");

    await expect(
      await canvas.findByTestId("kindle-send-status", {}, { timeout: 4000 }),
    ).toHaveTextContent("Sent to your Kindle.");
    await expect(canvas.getByRole("status")).toBeInTheDocument();
    await expect(sent).toEqual([{ book_uuid: UUID, file_id: null }]);
    await expect(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    ).toBeEnabled();
    // Four seconds on, the success clears itself.
    await waitFor(
      () =>
        expect(
          canvas.queryByTestId("kindle-send-status"),
        ).not.toBeInTheDocument(),
      {
        timeout: 6000,
      },
    );
  },
};

export const KindleFailureStaysUntilDismissed: Story = {
  beforeEach: kindle({ status: "failed", message: "SMTP refused the message" }),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    );

    await expect(
      await canvas.findByTestId("kindle-send-status"),
    ).toHaveTextContent("Send failed: SMTP refused the message");
    await userEvent.click(canvas.getByTestId("kindle-toast-dismiss"));
    await expect(
      canvas.queryByTestId("kindle-send-status"),
    ).not.toBeInTheDocument();
  },
};

export const KindleForgottenTaskIsUnconfirmed: Story = {
  beforeEach: kindle("unknown"),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    );

    await expect(
      await canvas.findByTestId("kindle-send-status"),
    ).toHaveTextContent("Send failed: could not confirm the send completed.");
  },
};

export const KindleQueueRefusedSaysWhy: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/kindle/send", 422));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    );

    await expect(
      await canvas.findByTestId("kindle-send-status"),
    ).toHaveTextContent("Send failed: failed with 422");
    await expect(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    ).toBeEnabled();
  },
};

export const EpubAtTheCapIsStillEmailed: Story = {
  args: props(["EPUB"], [{ id: 11, format: "EPUB" }], 50_000_000),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    ).toBeInTheDocument();
  },
};

export const EpubOverTheCapLinksToAmazonsUploader: Story = {
  args: props(["EPUB"], [{ id: 11, format: "EPUB" }], 50_000_001),
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: "Send to Kindle" }),
    ).not.toBeInTheDocument();
    const link = canvas.getByTestId("action-kindle-oversize");
    await expect(link).toHaveAttribute(
      "href",
      "https://www.amazon.com/sendtokindle",
    );
    await expect(link).toHaveAttribute("target", "_blank");
  },
};

export const LeavingStopsPollingTheSend: Story = {
  beforeEach: ({ msw }) => {
    sent.length = 0;
    polls.count = 0;
    // Slow answers, so Leave lands while a poll is in flight.
    msw.use(
      http.get("/api/kindle/send/status", async () => {
        polls.count++;
        await delay(500);
        return HttpResponse.json({ status: "pending" });
      }),
      ...kindleHandlers(["pending"], sent, polls),
    );
  },
  render: (args) => <Leavable {...args} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Send to Kindle" }),
    );
    await waitFor(() => expect(polls.count).toBeGreaterThan(0));

    await userEvent.click(canvas.getByRole("button", { name: "Leave" }));
    const asked = polls.count;
    await new Promise((resolve) => setTimeout(resolve, 1600));

    // The send was left pending, and nobody is asking about it any more.
    await expect(polls.count).toBe(asked);
  },
};

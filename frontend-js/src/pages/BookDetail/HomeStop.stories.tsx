import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { getGetSeriesByIdMockHandler200 } from "../../api/generated/omnibus.msw";
import { failing, hanging } from "../../testing/handlers";
import { aWireBook, aWireFile, aWireSeries } from "../../testing/wire";
import { HomeStop } from "./HomeStop";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

const EPUB = aWireFile({ id: 11, format: "EPUB" });
const AUDIO = aWireFile({
  id: 21,
  format: "M4B",
  filename: "a.m4b",
  size_bytes: 512_000_000,
});

function aBook(overrides: Parameters<typeof aWireBook>[0] = {}) {
  return toBookDetail(
    aWireBook({
      series_id: 4,
      genres: ["Science fiction"],
      subjects: ["Space opera"],
      formats: ["EPUB"],
      book_files: [EPUB],
      ...overrides,
    }),
  );
}

const meta = {
  title: "Pages/BookDetail/HomeStop",
  component: HomeStop,
  args: { book: aBook() },
  beforeEach({ msw }) {
    msw.use(getGetSeriesByIdMockHandler200(aWireSeries()));
  },
} satisfies Meta<typeof HomeStop>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InASeries: Story = {
  play: async ({ canvas }) => {
    const series = canvas.getByRole("link", { name: "Aurora Station" });
    await expect(series).toHaveAttribute("href", "/series/4");
    await expect(
      await canvas.findByText(/Book 1 · 3 in your library · 2021/),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
  },
};

export const SeriesCountLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/series/:id"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/· Book 1 · 2021/)).toBeInTheDocument();
    await expect(canvas.queryByText(/in your library/)).not.toBeInTheDocument();
  },
};

export const SeriesCountFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/series/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/· Book 1 · 2021/)).toBeInTheDocument();
    await expect(canvas.queryByText(/in your library/)).not.toBeInTheDocument();
  },
};

export const Standalone: Story = {
  args: { book: aBook({ series: null, series_id: null, series_index: null }) },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Science fiction · standalone · 2021"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Aurora Station" }),
    ).not.toBeInTheDocument();
  },
};

export const BlankSeriesName: Story = {
  args: { book: aBook({ series: "  ", series_id: 4 }) },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Science fiction · standalone · 2021"),
    ).toBeInTheDocument();
  },
};

export const Authors: Story = {
  args: {
    book: aBook({
      creators: [
        { name: "Sora Inkwell", id: 2 },
        { name: "Unlisted Translator" },
      ],
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Sora Inkwell" }),
    ).toHaveAttribute("href", "/authors/2");
    await expect(
      canvas.queryByRole("link", { name: "Unlisted Translator" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByText("Unlisted Translator")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Edit metadata" }),
    ).toHaveAttribute("href", `/books/${UUID}/edit`);
  },
};

export const OneEpub: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Start reading" }),
    ).toHaveAttribute("href", `/read/${UUID}`);
    await expect(
      canvas.queryByRole("link", { name: "Immersive" }),
    ).not.toBeInTheDocument();
  },
};

export const SeveralFiles: Story = {
  args: {
    book: aBook({
      formats: ["EPUB", "PDF"],
      book_files: [
        EPUB,
        aWireFile({
          id: 12,
          format: "PDF",
          filename: "a.pdf",
          label: "Print",
          size_bytes: 9_000_000,
        }),
      ],
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Choose which file to read" }),
    );

    const panel = canvas.getByRole("dialog", {
      name: "Choose which file to read",
    });
    await expect(panel).toHaveFocus();
    await expect(
      within(panel).getByText("2 files · choose one"),
    ).toBeInTheDocument();
    await expect(
      within(panel).getByRole("link", { name: /EPUB · Part 1/ }),
    ).toHaveAttribute("href", `/read/${UUID}?file_id=11`);
    await expect(
      within(panel).getByRole("link", { name: /PDF · Print/ }),
    ).toHaveAttribute("href", `/pdf/${UUID}?file_id=12`);

    await userEvent.keyboard("{Escape}");

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const ComicOnly: Story = {
  args: {
    book: aBook({
      formats: ["CBZ"],
      book_files: [aWireFile({ id: 13, format: "CBZ" })],
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Start reading" }),
    ).toHaveAttribute("href", `/comic/${UUID}`);
  },
};

export const PdfOnly: Story = {
  args: {
    book: aBook({
      formats: ["PDF"],
      book_files: [aWireFile({ id: 12, format: "PDF" })],
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Start reading" }),
    ).toHaveAttribute("href", `/pdf/${UUID}`);
  },
};

export const AudioOnly: Story = {
  args: { book: aBook({ formats: ["M4B"], book_files: [AUDIO] }) },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Start listening" }),
    ).toHaveAttribute("href", `/listen/${UUID}`);
    await expect(
      canvas.queryByRole("link", { name: "Listen" }),
    ).not.toBeInTheDocument();
  },
};

export const EbookAndAudio: Story = {
  args: {
    book: aBook({ formats: ["EPUB", "M4B"], book_files: [EPUB, AUDIO] }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Start reading" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Listen" })).toHaveAttribute(
      "href",
      `/listen/${UUID}`,
    );
    await expect(
      canvas.getByRole("link", { name: "Immersive" }),
    ).toHaveAttribute("href", `/read/${UUID}`);
  },
};

export const SeveralAudioFiles: Story = {
  args: {
    book: aBook({
      formats: ["M4B"],
      book_files: [
        AUDIO,
        aWireFile({
          ...AUDIO,
          id: 22,
          ordinal: 1,
          label: "Full cast",
          size_bytes: 600_000_000,
        }),
      ],
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Choose which file to listen to" }),
    );

    await expect(
      canvas.getByRole("link", { name: /Audiobook · Full cast/ }),
    ).toHaveAttribute("href", `/listen/${UUID}?file_id=22`);
    await expect(canvas.getByText("Full cast · 600.0 MB")).toBeInTheDocument();
  },
};

export const Fileless: Story = {
  args: { book: aBook({ formats: [], book_files: [] }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("no-files-disclaimer")).toHaveTextContent(
      "No ebook or audiobook files in your library yet",
    );
    await expect(
      canvas.queryByRole("link", { name: /Start/ }),
    ).not.toBeInTheDocument();
  },
};

export const LongDescription: Story = {
  args: {
    book: aBook({
      description: `<p>${"A station at the edge of the map hears something answer. ".repeat(6)}</p>`,
    }),
  },
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole("button", { name: "Show more" });
    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveTextContent("Show less");
  },
};

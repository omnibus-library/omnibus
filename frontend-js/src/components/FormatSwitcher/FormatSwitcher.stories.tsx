import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { aWireBook, aWireFile } from "../../testing/wire";
import { FormatSwitcher } from "./FormatSwitcher";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

function props(formats: string[], files: Parameters<typeof aWireFile>[0][]) {
  const book = toBookDetail(
    aWireBook({ formats, book_files: files.map(aWireFile) }),
  );
  return { uuid: book.uuid, formats: book.formats, files: book.bookFiles };
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
    await expect(within(group).getByText("3.0 MB")).toBeInTheDocument();
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
    await expect(canvas.getByText("768.7 MB")).toBeInTheDocument();
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
    await expect(canvas.getByText("2 editions")).toBeInTheDocument();
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

export const NoFormats: Story = {
  args: props([], []),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("group")).not.toBeInTheDocument();
  },
};

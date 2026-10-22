import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { physicalHandlers } from "../../testing/handlers";
import {
  aWireBook,
  aWireCopy,
  aWireFile,
  aWireWishlist,
} from "../../testing/wire";
import { FilesDetails } from "./FilesDetails";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

function aBook(overrides: Parameters<typeof aWireBook>[0] = {}) {
  return toBookDetail(
    aWireBook({
      formats: ["EPUB"],
      book_files: [aWireFile()],
      publisher: "Inkwell Press",
      language: "en",
      identifiers: [{ scheme: "15", value: "9780316769488" }],
      // Local noon, so the day reads the same in every zone.
      added_at: new Date(2024, 4, 1, 12).toISOString(),
      ...overrides,
    }),
  );
}

const meta = {
  title: "Pages/BookDetail/FilesDetails",
  component: FilesDetails,
  args: { book: aBook() },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({}));
  },
} satisfies Meta<typeof FilesDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

const rowsOf = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );

export const Complete: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Formats and copies")).toBeInTheDocument();
    await expect(
      canvas.getByRole("group", { name: "Available formats" }),
    ).toBeInTheDocument();
    await expect(rowsOf(canvas.getByRole("table"))).toEqual([
      ["Title", "Aurora Station, Vol. 1"],
      ["Author", "Sora Inkwell"],
      ["Publisher", "Inkwell Press"],
      ["Published", "Mar 1st, 2021"],
      ["Language", "en"],
      ["ISBN-13", "9780316769488"],
      ["Added", "May 1st, 2024"],
    ]);
    await expect(
      canvas.getByRole("link", { name: "Edit metadata…" }),
    ).toHaveAttribute("href", `/books/${UUID}/edit`);
  },
};

export const Sparse: Story = {
  args: {
    book: aBook({
      publisher: null,
      published: "0101-01-01T00:00:00+00:00",
      language: null,
      identifiers: [],
      added_at: null,
      creators: [],
    }),
  },
  play: async ({ canvas }) => {
    await expect(rowsOf(canvas.getByRole("table"))).toEqual([
      ["Title", "Aurora Station, Vol. 1"],
    ]);
  },
};

export const SavedIsbnReplacesTheFilesOwn: Story = {
  args: {
    book: aBook({
      identifiers: [{ scheme: "02", value: "9780316259088" }],
      isbn13: "9780316259088",
      isbn10: "031625908X",
    }),
  },
  play: async ({ canvas }) => {
    const rows = rowsOf(canvas.getByRole("table"));
    await expect(rows).toContainEqual(["ISBN-13", "9780316259088"]);
    await expect(rows).toContainEqual(["ISBN-10", "031625908X"]);
    await expect(
      rows.filter(([label]) => label?.startsWith("ISBN")),
    ).toHaveLength(2);
  },
};

export const Fileless: Story = {
  args: { book: aBook({ formats: [], book_files: [] }) },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("group", { name: "Available formats" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("table")).toBeInTheDocument();
  },
};

export const ListsCopiesAndTheWishlistAmongTheFormats: Story = {
  args: { book: aBook({ formats: [], book_files: [] }) },
  beforeEach({ msw }) {
    msw.use(
      ...physicalHandlers({
        copies: [aWireCopy()],
        wishlist: aWireWishlist(),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("physical-copy-card"),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByTestId("wishlist-card"),
    ).toBeInTheDocument();
  },
};

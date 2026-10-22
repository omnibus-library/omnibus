import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fn, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetAlignmentMockHandler200,
  getGetProgressMockHandler200,
} from "../../api/generated/omnibus.msw";
import { nowSecs } from "../../format";
import {
  failing,
  followHandlers,
  physicalHandlers,
} from "../../testing/handlers";
import {
  aWireAlignment,
  aWireBook,
  aWireCopy,
  aWireFile,
  aWirePosition,
  aWireProgress,
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
  args: { book: aBook(), onOpenDialog: fn() },
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

const AUDIO = aWireFile({
  id: 21,
  format: "M4B",
  filename: "a.m4b",
  size_bytes: 512_000_000,
});

const DUAL = aBook({
  formats: ["EPUB", "M4B"],
  book_files: [aWireFile({ id: 11, format: "EPUB" }), AUDIO],
});

const ALIGNED = aWireAlignment({
  ebook: { total_chars: 1000, chapters: [] },
  audio_files: [
    {
      book_file_id: 21,
      duration_seconds: 10_800,
      chapter_starts: [],
      label: "a.m4b",
    },
  ],
  listening: { book_file_id: 21, seconds: 5400, client_updated_at: nowSecs() },
  link: {
    confirmed_at: nowSecs() - 3 * 86_400,
    stale: false,
    follow: true,
    mode: "sequence",
  },
});

export const DualFormatShowsTheSyncLine: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    msw.use(
      getGetProgressMockHandler200(
        aWireProgress(
          aWirePosition({ progress_percent: 45 }),
          aWirePosition({
            format: "audio",
            audio_position_seconds: 5400,
            progress_percent: 50,
          }),
        ),
      ),
      getGetAlignmentMockHandler200(ALIGNED),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        /one spot, both formats — audio at 1h 30m · confirmed 3d ago/,
      ),
    ).toBeInTheDocument();
  },
};

export const SyncUnlinked: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    msw.use(getGetAlignmentMockHandler200({ ...ALIGNED, link: null }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "⇄ positions aren't synced — each format keeps its own spot",
      ),
    ).toBeInTheDocument();
  },
};

export const SyncStale: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    msw.use(
      getGetAlignmentMockHandler200({
        ...ALIGNED,
        link: { confirmed_at: 1, stale: true, follow: true, mode: "sequence" },
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "⇄ the audiobook files changed since you linked — sync is paused",
      ),
    ).toHaveAttribute("role", "status");
  },
};

const followWrites: { enabled: boolean }[] = [];
const followReads = { count: 0 };

export const SyncFollowSwitch: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    followWrites.length = 0;
    followReads.count = 0;
    msw.use(...followHandlers(ALIGNED, followWrites, followReads));
  },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Follow the other format",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toHaveTextContent("following");

    await userEvent.click(toggle);

    await waitFor(() => expect(followWrites).toEqual([{ enabled: false }]));
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-checked", "false"),
    );
    await expect(toggle).toHaveTextContent("not following");

    // And it holds once the page has asked the server again.
    await waitFor(() => expect(followReads.count).toBe(2));
    await expect(toggle).toHaveTextContent("not following");
  },
};

export const SyncFollowFails: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/books/:uuid/cross-format-follow",
        () => new HttpResponse("link not confirmed", { status: 409 }),
      ),
      getGetAlignmentMockHandler200(ALIGNED),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("switch", { name: "Follow the other format" }),
    );

    await expect(
      await canvas.findByText("link not confirmed"),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};

export const SyncLoadFails: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/books/:uuid/alignment", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("couldn't load the sync status"),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeEnabled();
  },
};

export const ExportTriggerOnlyForABookWithAFileToSend: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /Export/ }),
    ).toBeInTheDocument();
  },
};

export const ComicOnlyBookHasNothingToExport: Story = {
  args: {
    book: aBook({
      formats: ["CBZ"],
      book_files: [aWireFile({ id: 31, format: "CBZ" })],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("edit-metadata")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: /Export/ }),
    ).not.toBeInTheDocument();
  },
};

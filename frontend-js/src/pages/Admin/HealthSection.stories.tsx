import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { adminHealthQuery } from "../../api";
import { storyClient } from "../../testing/AppHarness";
import {
  adminHealthHandler,
  aWireAdminHealth,
} from "../../testing/adminHandlers";
import { failing, hanging } from "../../testing/handlers";
import { HealthSection } from "./HealthSection";

const HEALTH = "/api/admin/health";

// Only the interval story waits out one real 5 s poll; the rest ask for the next read.
const NEXT_POLL = { timeout: 8_000 };

const readAgain = () =>
  storyClient().refetchQueries({ queryKey: adminHealthQuery.queryKey });

/** A card's label and value rows, as "label: value". */
const kvRows = (card: HTMLElement) =>
  [...card.querySelectorAll(".ah-kv-row")].map((row) =>
    [...row.children].map((cell) => cell.textContent).join(": "),
  );

let polledAt: number[] = [];

const meta = {
  title: "Pages/Admin/HealthSection",
  component: HealthSection,
  beforeEach({ msw }) {
    msw.use(adminHealthHandler(aWireAdminHealth));
  },
} satisfies Meta<typeof HealthSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(HEALTH));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("admin-health-loading"),
    ).toHaveTextContent("Taking the server's pulse");
    await expect(
      canvas.queryByTestId("admin-health-grid"),
    ).not.toBeInTheDocument();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", HEALTH, 500));
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByTestId("admin-health-error");
    await expect(status).toHaveTextContent(
      "Couldn’t load server health. It’s retried every few seconds.",
    );
    await expect(status).toHaveClass("settings-status", "error");
    await expect(status).toHaveAttribute("role", "status");
    await expect(
      canvas.queryByTestId("admin-health-grid"),
    ).not.toBeInTheDocument();
  },
};

export const ShowsTheFourCardsAndTheLastErrors: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("admin-health-grid");
    await expect(
      canvas.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      "Index status",
      "Worker queue",
      "Search index (FTS)",
      "Storage",
      "Last errors",
    ]);
  },
};

export const ShowsTheIndexStatus: Story = {
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("admin-health-index-card");
    await expect(kvRows(card)).toEqual([
      "Ebook library: /library/ebooks",
      "Audiobook library: /library/audiobooks",
      "Books indexed: 42",
      "Authors indexed: 7",
      "Series indexed: 3",
    ]);
    const ok = within(card).getByTestId("admin-health-ghosted-ok");
    await expect(ok).toHaveTextContent("No ghosted books.");
    await expect(ok).toHaveClass("settings-status", "success");
    await expect(
      within(card).queryByTestId("admin-health-ghosted-warning"),
    ).not.toBeInTheDocument();
  },
};

export const ReadsAnUnsetLibraryFolderAsNotConfigured: Story = {
  beforeEach({ msw }) {
    const base = aWireAdminHealth();
    msw.use(
      adminHealthHandler(() => ({
        ...base,
        index: {
          ...base.index,
          ebook_library_path: "   ",
          audiobook_library_path: null,
        },
      })),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("admin-health-index-card");
    await expect(kvRows(card).slice(0, 2)).toEqual([
      "Ebook library: Not configured",
      "Audiobook library: Not configured",
    ]);
  },
};

export const WarnsAboutGhostedBooks: Story = {
  beforeEach({ msw }) {
    const base = aWireAdminHealth();
    msw.use(
      adminHealthHandler(() => ({
        ...base,
        index: { ...base.index, ghosted_book_count: 2 },
      })),
    );
  },
  play: async ({ canvas }) => {
    const warning = await canvas.findByTestId("admin-health-ghosted-warning");
    await expect(warning).toHaveTextContent(
      "2 books have no file on disk (ghosted by a prior reindex).",
    );
    await expect(warning).toHaveClass("settings-status", "error");
    await expect(
      canvas.queryByTestId("admin-health-ghosted-ok"),
    ).not.toBeInTheDocument();
  },
};

export const ShowsAnEmptyWorkerQueue: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("admin-health-worker-empty"),
    ).toHaveTextContent("No active or recently completed background tasks.");
    await expect(
      canvas.queryByTestId("admin-health-worker-table"),
    ).not.toBeInTheDocument();
  },
};

export const ListsTheWorkerQueue: Story = {
  beforeEach({ msw }) {
    msw.use(
      adminHealthHandler(() =>
        aWireAdminHealth({
          worker_queue: [
            { kind: "scan", queue_depth: 1, recent_completions_ms: [120, 340] },
            {
              kind: "generate_thumbs",
              queue_depth: 0,
              recent_completions_ms: [14_497],
            },
            {
              kind: "backfill_chapters",
              queue_depth: 0,
              recent_completions_ms: [],
            },
          ],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const table = await canvas.findByTestId("admin-health-worker-table");
    await expect(table).toHaveClass("users-table");
    await expect(table.closest(".table-scroll")).not.toBeNull();
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Task", "Queued", "Done recently", "Last took"]);
    await expect(
      within(table)
        .getAllByTestId("admin-health-worker-row")
        .map((row) =>
          within(row)
            .getAllByRole("cell")
            .map((cell) => cell.textContent),
        ),
    ).toEqual([
      ["Scanning library", "1", "2", "340 ms"],
      ["Thumbnail generation", "0", "1", "14.5 s"],
      ["Audiobook chapter extraction", "0", "0", "—"],
    ]);
  },
};

export const ReportsAnInSyncSearchIndex: Story = {
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("admin-health-fts-card");
    await expect(kvRows(card)).toEqual(["Books rows: 42", "FTS rows: 42"]);
    const status = within(card).getByTestId("admin-health-fts-in-sync");
    await expect(status).toHaveTextContent("In sync.");
    await expect(status).toHaveClass("settings-status", "success");
  },
};

export const ReportsAnOutOfSyncSearchIndex: Story = {
  beforeEach({ msw }) {
    msw.use(
      adminHealthHandler(() =>
        aWireAdminHealth({
          fts: { books_rows: 10, fts_rows: 4, in_sync: false },
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("admin-health-fts-card");
    await expect(kvRows(card)).toEqual(["Books rows: 10", "FTS rows: 4"]);
    const status = within(card).getByTestId("admin-health-fts-out-of-sync");
    await expect(status).toHaveTextContent(
      "Out of sync. Search can miss or misreport books until the index is rebuilt with POST /api/fts/rebuild.",
    );
    await expect(status).toHaveClass("settings-status", "error");
    await expect(
      within(status).getByText("POST /api/fts/rebuild"),
    ).toHaveProperty("tagName", "CODE");
    await expect(
      within(card).queryByTestId("admin-health-fts-in-sync"),
    ).not.toBeInTheDocument();
  },
};

export const ShowsTheStorageFigures: Story = {
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("admin-health-storage-card");
    await expect(kvRows(card)).toEqual([
      "Library content: 3.1 MB",
      "Covers: 512 B",
      "Thumbnail cache: 1.0 KB / 5.0 GB cap",
      "HLS transcode cache: 0 B / 5.0 GB cap",
      "Export-EPUB cache: 2.0 KB / 5.0 GB cap",
    ]);
  },
};

export const ShowsAnEmptyErrorLog: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("admin-health-errors-empty"),
    ).toHaveTextContent("No errors captured since the server started.");
    await expect(
      canvas.queryByTestId("admin-health-errors-table"),
    ).not.toBeInTheDocument();
  },
};

export const ListsTheLastErrors: Story = {
  beforeEach({ msw }) {
    msw.use(
      adminHealthHandler(() =>
        aWireAdminHealth({
          last_errors: [
            {
              timestamp: 1_700_000_000,
              target: "omnibus::scanner",
              message: "unreadable epub",
              book_uuid: "uuid-1",
              file: "/lib/broken.epub",
            },
            {
              timestamp: 1_700_000_060,
              target: "omnibus::mail",
              message: "relay refused",
              book_uuid: null,
              file: null,
            },
          ],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const stream = await canvas.findByRole("region", {
      name: "Recent server errors",
    });
    await expect(
      within(stream)
        .getAllByTestId("admin-health-errors-row")
        .map((row) => row.textContent),
    ).toEqual([
      "2023-11-14 22:13:20 UTC ERROR omnibus::scanner unreadable epub Open book /lib/broken.epub",
      "2023-11-14 22:14:20 UTC ERROR omnibus::mail relay refused",
    ]);
    // One link and one file name in the whole stream: only the first error names a book.
    await expect(
      within(stream).getByRole("link", { name: "Open book" }),
    ).toHaveAttribute("href", "/books/uuid-1");
    await expect(
      within(stream).getByTestId("admin-health-errors-file"),
    ).toHaveTextContent("/lib/broken.epub");
  },
};

export const ReadsTheReportAgainEveryFiveSeconds: Story = {
  beforeEach({ msw }) {
    polledAt = [];
    msw.use(
      http.get(HEALTH, () => {
        polledAt.push(Date.now());
        const base = aWireAdminHealth();
        return HttpResponse.json({
          ...base,
          index: { ...base.index, book_count: 41 + polledAt.length },
        });
      }),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("admin-health-index-card");
    await expect(kvRows(card)[2]).toBe("Books indexed: 42");

    await waitFor(
      () => expect(kvRows(card)[2]).toBe("Books indexed: 43"),
      NEXT_POLL,
    );
    // The timer may fire a few milliseconds early.
    await expect(
      (polledAt[1] ?? 0) - (polledAt[0] ?? 0),
    ).toBeGreaterThanOrEqual(4_900);
  },
};

export const KeepsTheLastReportWhenALaterPollFails: Story = {
  beforeEach({ msw }) {
    let polls = 0;
    msw.use(
      http.get(HEALTH, () =>
        ++polls === 1
          ? HttpResponse.json(aWireAdminHealth())
          : new HttpResponse("failed with 500", { status: 500 }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("admin-health-grid");

    await readAgain();

    await expect(
      storyClient().getQueryState(adminHealthQuery.queryKey)?.status,
    ).toBe("error");
    await expect(canvas.getByTestId("admin-health-grid")).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("admin-health-error"),
    ).not.toBeInTheDocument();
  },
};

export const RecoversWhenALaterPollSucceeds: Story = {
  beforeEach({ msw }) {
    let polls = 0;
    msw.use(
      http.get(HEALTH, () =>
        ++polls === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireAdminHealth()),
      ),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("admin-health-error");

    await readAgain();

    await expect(
      await canvas.findByTestId("admin-health-grid"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("admin-health-error"),
    ).not.toBeInTheDocument();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetAlignmentMockHandler200,
  getGetBookInsightsMockHandler200,
  getGetProgressMockHandler200,
} from "../../api/generated/omnibus.msw";
import {
  bookDetailHandlers,
  failing,
  followHandlers,
  hanging,
  physicalHandlers,
  readStatusHandlers,
} from "../../testing/handlers";
import {
  aWireAlignment,
  aWireBook,
  aWireFile,
  aWireInsights,
  aWirePosition,
  aWireProgress,
  aWireReadStatus,
  aWireWishlist,
} from "../../testing/wire";
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
    msw.use(...bookDetailHandlers(aWireBook()));
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

let seriesAsked = false;

export const SeriesCountFailing: Story = {
  beforeEach({ msw }) {
    seriesAsked = false;
    msw.use(
      http.get("/api/series/:id", () => {
        seriesAsked = true;
        return new HttpResponse("failed with 500", { status: 500 });
      }),
    );
  },
  play: async ({ canvas }) => {
    // Absence only means something once the series has answered.
    await waitFor(() => expect(seriesAsked).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
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

const SeveralFilesArgs = {
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
};

export const PickerKeepsFocusWhenThePageRerenders: Story = {
  args: SeveralFilesArgs,
  beforeEach({ msw }) {
    // The answer lands after the picker is open and focused on its second item.
    msw.use(
      http.get("/api/progress/:uuid", async () => {
        await delay(600);
        return HttpResponse.json(aWireProgress());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Choose which file to read" }),
    );
    const panel = canvas.getByRole("dialog", {
      name: "Choose which file to read",
    });
    await waitFor(() => expect(panel).toHaveFocus());
    await userEvent.tab();
    await userEvent.tab();
    const second = within(panel).getByRole("link", { name: /PDF · Print/ });
    await expect(second).toHaveFocus();

    await new Promise((resolve) => setTimeout(resolve, 900));

    await expect(second).toHaveFocus();
  },
};

export const SeveralFiles: Story = {
  args: SeveralFilesArgs,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Choose which file to read" }),
    );

    const panel = canvas.getByRole("dialog", {
      name: "Choose which file to read",
    });
    await waitFor(() => expect(panel).toHaveFocus());
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

const nowSecs = () => Math.floor(Date.now() / 1000);

const CHAPTERS = [
  { title: "Front matter", percent: 0, spine_index: 0 },
  { title: "Chapter One", percent: 20, spine_index: 2 },
  { title: "Chapter Two", percent: 60, spine_index: 4 },
];

const DUAL = aBook({ formats: ["EPUB", "M4B"], book_files: [EPUB, AUDIO] });

const ALIGNED = aWireAlignment({
  ebook: { total_chars: 1000, chapters: CHAPTERS },
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

export const ReadStatusNotStarted: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("read-status-meta"),
    ).toHaveTextContent("Not started");
    await expect(
      canvas.getByRole("button", { name: "Unread" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const ReadStatusReading: Story = {
  beforeEach({ msw }) {
    msw.use(...readStatusHandlers(aWireReadStatus({ status: "reading" })));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Reading" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await expect(canvas.getByTestId("read-status-meta")).toHaveTextContent(
      "In progress",
    );
  },
};

export const ReadStatusFinished: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(
        aWireReadStatus({
          status: "finished",
          finished_at: nowSecs() - 3 * 3600,
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("read-status-meta")).toHaveTextContent(
        "Finished 3 hours ago",
      ),
    );
  },
};

const statusWrites: { status: string }[] = [];

export const ReadStatusSaved: Story = {
  beforeEach({ msw }) {
    statusWrites.length = 0;
    msw.use(...readStatusHandlers(null, statusWrites));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Finished" }),
    );

    await expect(
      canvas.getByRole("button", { name: "Finished" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(statusWrites).toEqual([{ book_uuid: UUID, status: "finished" }]),
    );
    await waitFor(() =>
      expect(canvas.getByTestId("read-status-meta")).toHaveTextContent(
        "Finished just now",
      ),
    );
  },
};

export const ReadStatusSaveFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("put", "/api/read-status", 500),
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Reading" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Finished" }));

    await expect(
      await canvas.findByText("Couldn't save — try again"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Reading" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

const WITH_CHAPTERS = getGetAlignmentMockHandler200(
  aWireAlignment({ ebook: { total_chars: 1000, chapters: CHAPTERS } }),
);

export const ResumeNamesTheChapter: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetProgressMockHandler200(
        aWireProgress(
          aWirePosition({
            progress_percent: 45,
            epub_cfi: "epubcfi(/6/6!/4/2/1:0)",
          }),
        ),
      ),
      WITH_CHAPTERS,
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Resume — Ch. 2 · Chapter One" }),
    ).toBeInTheDocument();
    const ruler = canvas.getByTestId("bdmq-ruler");
    await expect(
      within(ruler).getByText("Ch. 2 of 3 · 45%"),
    ).toBeInTheDocument();
    await expect(within(ruler).getByText("Ch. 2")).toBeInTheDocument();
    await expect(within(ruler).getByText(/^last opened /)).toBeInTheDocument();
  },
};

export const ResumeWithoutAChapterTable: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 45 })),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Resume reading" }),
    ).toBeInTheDocument();
    await expect(
      within(canvas.getByTestId("bdmq-ruler")).getByText("45% of the book"),
    ).toBeInTheDocument();
  },
};

export const NotStartedHasNoRuler: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Start reading" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("bdmq-ruler")).not.toBeInTheDocument();
  },
};

export const FinishedBook: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 100 })),
      ),
    );
  },
  play: async ({ canvas }) => {
    const ruler = await canvas.findByTestId("bdmq-ruler");
    await expect(ruler.querySelector(".rx-fill")).toHaveClass("done");
    await expect(ruler.querySelector(".rx-caret")).toBeNull();
  },
};

export const ListeningResumes: Story = {
  args: { book: aBook({ formats: ["M4B"], book_files: [AUDIO] }) },
  beforeEach({ msw }) {
    msw.use(
      getGetProgressMockHandler200(
        aWireProgress(
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
      await canvas.findByRole("link", { name: "Resume listening from 1h 30m" }),
    ).toBeInTheDocument();
    const ruler = canvas.getByTestId("bdmq-ruler");
    await expect(
      within(ruler).getByText("1h 30m of 3h 00m · 50%"),
    ).toBeInTheDocument();
    await expect(
      within(ruler).getByText("≈ 1h 30m left at 1.0×"),
    ).toBeInTheDocument();
  },
};

export const DualFormatShowsTheSyncLine: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    msw.use(
      getGetProgressMockHandler200(
        aWireProgress(
          aWirePosition({
            progress_percent: 45,
            epub_cfi: "epubcfi(/6/6!/4/2/1:0)",
          }),
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
      await canvas.findByRole("link", { name: "Listen from 1h 30m" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByText(
        /one spot, both formats — audio at 1h 30m · confirmed 3d ago/,
      ),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/^last opened /)).not.toBeInTheDocument();
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

export const SyncFollowSwitch: Story = {
  args: { book: DUAL },
  beforeEach({ msw }) {
    followWrites.length = 0;
    msw.use(...followHandlers(ALIGNED, followWrites));
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
    await new Promise((resolve) => setTimeout(resolve, 300));
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

export const SparseDescriptionOffersFetchSummary: Story = {
  args: { book: aBook({ description: "<p>Too short.</p>" }) },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Fetch Summary" }),
    ).toBeEnabled();
  },
};

export const LongDescriptionHasNoFetchSummary: Story = {
  args: {
    book: aBook({
      description: `<p>${"A station at the edge of the map hears something answer. ".repeat(3)}</p>`,
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: "Fetch Summary" }),
    ).not.toBeInTheDocument();
  },
};

export const WishlistOnlyBook: Story = {
  args: {
    book: aBook({ formats: [], book_files: [], series: null, series_id: null }),
  },
  beforeEach({ msw }) {
    msw.use(
      ...physicalHandlers({
        wishlist: aWireWishlist({ added_at: 1_760_000_000, source: "scan" }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("On your wishlist · added from a scan"),
    ).toBeInTheDocument();
    const find = canvas.getByRole("link", { name: "Find a copy" });
    await expect(find).toHaveAttribute("target", "_blank");
    await expect(
      canvas.getByRole("link", { name: "Check in when acquired" }),
    ).toHaveAttribute("href", "/check-in");
    await expect(canvas.getByTestId("wishlist-remove")).toHaveTextContent(
      "Remove from wishlist",
    );
    await expect(
      canvas.getByText(/tracking since Oct 9th, 2025|tracking since October/),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("start-reading")).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("no-files-disclaimer"),
    ).not.toBeInTheDocument();
  },
};

export const FilelessBookNotOnTheWishlist: Story = {
  args: { book: aBook({ formats: [], book_files: [] }) },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({}));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("no-files-disclaimer"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("find-a-copy")).not.toBeInTheDocument();
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
    await canvas.findByTestId("start-reading-comic");
    await expect(
      canvas.queryByRole("button", { name: /Export/ }),
    ).not.toBeInTheDocument();
  },
};

export const RulerEstimatesTimeLeftAtTheReadersPace: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights({ seconds_total: 3600 })),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 40 })),
      ),
    );
  },
  play: async ({ canvas }) => {
    const ruler = await canvas.findByTestId("bdmq-ruler");
    await expect(
      await within(ruler).findByText("≈ 1h 30m left at your pace"),
    ).toBeInTheDocument();
  },
};

export const RulerPrefersTheAudioTimelineToThePace: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 40 })),
      ),
      getGetAlignmentMockHandler200(ALIGNED),
    );
  },
  args: { book: DUAL },
  play: async ({ canvas }) => {
    const ruler = await canvas.findByTestId("bdmq-ruler");
    await expect(
      await within(ruler).findByText(/left at 1.0×/),
    ).toBeInTheDocument();
    await expect(
      within(ruler).queryByText(/at your pace/),
    ).not.toBeInTheDocument();
  },
};

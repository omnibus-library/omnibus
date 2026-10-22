import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import type { ComponentProps } from "react";
import { expect, fn, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetAlignmentMockHandler200,
  getGetBookInsightsMockHandler200,
  getGetProgressMockHandler200,
} from "../../api/generated/omnibus.msw";
import type { ReviewPatch } from "../../api/generated/schemas";
import { nowSecs } from "../../format";
import {
  bookDetailHandlers,
  failing,
  followHandlers,
  hanging,
  physicalHandlers,
  readStatusHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import {
  aWireAlignment,
  aWireBook,
  aWireFile,
  aWireInsights,
  aWireOtherReview,
  aWirePosition,
  aWireProgress,
  aWireReadStatus,
  aWireReview,
  aWireWishlist,
} from "../../testing/wire";
import { Hero } from "./Hero";
import { useMyRating } from "./useMyRating";
import "./BookDetail.css";
import "./BookPage.css";

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

/** The hero under the page's one queue of writes, inside the stage's dark scope. */
function HeroInPage(props: Omit<ComponentProps<typeof Hero>, "rating">) {
  const rating = useMyRating(props.book.uuid);
  return (
    <div className="bp-root">
      <div className="bp-stage">
        <div className="bp-stage-body">
          <Hero {...props} rating={rating} />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Pages/BookDetail/Hero",
  component: HeroInPage,
  args: { book: aBook(), onShowSeries: fn(), onOpenReview: fn() },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook()));
  },
} satisfies Meta<typeof HeroInPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const writes: ReviewPatch[] = [];

/** The width each of your five stars is filled to, as drawn. */
const fills = (canvasElement: HTMLElement) =>
  [
    ...canvasElement.querySelectorAll<HTMLElement>(
      '[data-testid="review-stars"] .bd-star-fg',
    ),
  ].map((fg) => fg.style.width);

export const TitleBylineAndFactLine: Story = {
  args: {
    book: aBook({
      published: "2014-02-18",
      publisher: "Del Rey",
      page_count: 382,
      language: "en",
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("book-authors")).toHaveTextContent(
      "Sora Inkwell · Aurora Station, book 1",
    );
    await expect(
      canvas.getByText("2014 · Del Rey · 382 pages · English"),
    ).toBeInTheDocument();
  },
};

export const InASeries: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const series = canvas.getByRole("button", {
      name: "Aurora Station, book 1",
    });

    await userEvent.click(series);

    await expect(args.onShowSeries).toHaveBeenCalledOnce();
  },
};

export const SeriesCountLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/series/:id"));
  },
  play: async ({ canvas }) => {
    // The byline is the book's own record: it never waits on the series page.
    await expect(
      canvas.getByRole("button", { name: "Aurora Station, book 1" }),
    ).toBeInTheDocument();
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
    await expect(
      canvas.getByRole("button", { name: "Aurora Station, book 1" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/in your library/)).not.toBeInTheDocument();
    await expect(seriesAsked).toBe(false);
  },
};

export const Standalone: Story = {
  args: { book: aBook({ series: null, series_id: null, series_index: null }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("book-authors")).toHaveTextContent(
      "Sora Inkwell",
    );
    await expect(canvas.getByTestId("book-authors")).not.toHaveTextContent("·");
    await expect(
      canvas.queryByRole("button", { name: /Aurora Station/ }),
    ).not.toBeInTheDocument();
  },
};

export const BlankSeriesName: Story = {
  args: { book: aBook({ series: "  ", series_id: 4 }) },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: /book 1/ }),
    ).not.toBeInTheDocument();
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

export const YourStarsSitBesideTheHouseholdsRatings: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...reviewHandlers({
        mine: aWireReview({ stars: 4 }),
        others: [
          aWireOtherReview({ user_id: 7, username: "grace", stars: 4.5 }),
          aWireOtherReview({ user_id: 8, username: "linus", stars: 3 }),
          // Said something but gave no stars: nothing to list.
          aWireOtherReview({ user_id: 9, username: "tove", stars: null }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("group", { name: "Your rating" }),
    ).toBeInTheDocument();
    const list = await canvas.findByRole("list", {
      name: "Household ratings",
    });
    const rows = within(list).getAllByRole("listitem");
    await expect(rows).toHaveLength(3);
    await expect(rows[0]).toHaveTextContent("grace");
    await expect(
      within(rows[0] as HTMLElement).getByRole("img", {
        name: "4.5 out of 5 stars",
      }),
    ).toBeInTheDocument();
    await expect(rows[0]).toHaveTextContent("4.5");
    await expect(rows[1]).toHaveTextContent("linus");
    await expect(rows[2]).toHaveTextContent("You");
    await expect(
      within(rows[2] as HTMLElement).getByRole("img", {
        name: "4 out of 5 stars",
      }),
    ).toBeInTheDocument();
  },
};

export const NoHouseholdListWhenNobodyRated: Story = {
  beforeEach({ msw }) {
    msw.use(...reviewHandlers({}));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("group", { name: "Your rating" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(
      canvas.queryByRole("list", { name: "Household ratings" }),
    ).not.toBeInTheDocument();
  },
};

export const RatingAddsAYouRow: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...reviewHandlers({}, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 4 stars" }),
    );

    const list = await canvas.findByRole("list", {
      name: "Household ratings",
    });
    await expect(within(list).getByRole("listitem")).toHaveTextContent("You");
    await expect(
      within(list).getByRole("img", { name: "4 out of 5 stars" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(writes).toEqual([{ stars: 4 }]));
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "You rated it 4",
    );
  },
};

export const HoveringPreviewsTheExactValue: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...reviewHandlers({ mine: aWireReview({ stars: 4 }) }, writes));
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const note = canvas.getByTestId("review-stars-meta");
    await waitFor(() => expect(note).toHaveTextContent("You rated it 4"));

    // The left half of the fourth star is 3.5.
    await userEvent.hover(
      canvas.getByRole("button", { name: "Rate 3.5 stars" }),
    );

    await expect(note).toHaveTextContent("Rate 3.5");
    await expect(fills(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "50%",
      "0%",
    ]);

    await userEvent.unhover(
      canvas.getByRole("button", { name: "Rate 3.5 stars" }),
    );

    await expect(note).toHaveTextContent("You rated it 4");
    await expect(fills(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "100%",
      "0%",
    ]);
    await expect(writes).toEqual([]);
  },
};

export const OneClickRatesOnceAndPopsOnce: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...reviewHandlers({}, writes));
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const pops: string[] = [];
    canvasElement.addEventListener("animationstart", (event) => {
      if (event.animationName === "bd-star-pop") pops.push(event.animationName);
    });

    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 3.5 stars" }),
    );

    await waitFor(() => expect(writes).toEqual([{ stars: 3.5 }]));
    await waitFor(() => expect(pops).toHaveLength(1));
    // Past the pop's length, nothing rated or popped a second time.
    await new Promise((resolve) => setTimeout(resolve, 700));
    await expect(writes).toEqual([{ stars: 3.5 }]);
    await expect(pops).toHaveLength(1);
  },
};

export const ArrowKeysRateInHalfSteps: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...reviewHandlers({ mine: aWireReview({ stars: 3 }) }, writes));
  },
  play: async ({ canvas, userEvent }) => {
    const rated = await canvas.findByRole("button", {
      name: "Clear your 3-star rating",
    });
    rated.focus();

    await userEvent.keyboard("{ArrowRight}");

    await waitFor(() => expect(writes).toEqual([{ stars: 3.5 }]));
    await expect(
      canvas.getByRole("button", { name: "Clear your 3.5-star rating" }),
    ).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");

    await waitFor(() =>
      expect(writes).toEqual([{ stars: 3.5 }, { stars: 3 }, { stars: 2.5 }]),
    );
  },
};

export const ChevronAsksForThatReadersReview: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...reviewHandlers({
        others: [aWireOtherReview({ user_id: 7, username: "grace", stars: 5 })],
      }),
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "See grace's review" }),
    );

    await expect(args.onOpenReview).toHaveBeenCalledWith(7);
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
    await waitFor(() =>
      expect(canvas.getByTestId("read-status-meta")).toHaveTextContent(
        "Not started",
      ),
    );
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
    // The control is disabled until the status has been read.
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Finished" })).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Finished" }));

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

export const ReadStatusClaimsNothingWhileItLoads: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/read-status/:uuid"));
  },
  play: async ({ canvas }) => {
    const unread = await canvas.findByRole("button", { name: "Unread" });
    await expect(unread).toBeDisabled();
    await expect(unread).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByTestId("read-status-meta")).not.toHaveTextContent(
      "Not started",
    );
  },
};

export const ReadStatusOffersRetryWhenItCannotBeRead: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get("/api/read-status/:uuid", () =>
        reads++ === 0
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireReadStatus({ status: "reading" })),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText("Couldn't load your reading status"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Unread" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByRole("button", { name: "Unread" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Reading" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
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

export const WishlistCheckInCarriesTheBooksIsbn: Story = {
  args: {
    book: aBook({
      formats: [],
      book_files: [],
      isbn13: "9780134685991",
    }),
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
      await canvas.findByRole("link", { name: "Check in when acquired" }),
    ).toHaveAttribute("href", "/check-in?isbn=9780134685991");
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

let reviewsRead = false;

export const NoHouseholdRatingUntilTheServerSumsOne: Story = {
  beforeEach({ msw }) {
    reviewsRead = false;
    msw.use(
      http.get("/api/reviews/:uuid", () => {
        reviewsRead = true;
        // Two raters, but the threshold is the server's: no summary sent, none drawn.
        return HttpResponse.json({
          mine: aWireReview({ stars: 5 }),
          others: [aWireOtherReview({ user_id: 7, stars: 4 })],
          summary: null,
        });
      }),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(reviewsRead).toBe(true));
    await canvas.findByRole("list", { name: "Household ratings" });
    // The household's average is the server's to give; the hero adds no figure of its own.
    await expect(canvas.queryByText(/\d readers?/)).not.toBeInTheDocument();
  },
};

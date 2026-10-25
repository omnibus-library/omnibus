import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import type { ComponentProps } from "react";
import { useLocation } from "react-router";
import { expect, fn, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetAlignmentMockHandler200,
  getGetBookInsightsMockHandler200,
  getGetHighlightsMockHandler200,
  getGetProgressMockHandler200,
  getGetSeriesByIdMockHandler200,
} from "../../api/generated/omnibus.msw";
import type { ReviewPatch } from "../../api/generated/schemas";
import { ToastProvider } from "../../components/Toast/Toast";
import { nowSecs } from "../../format";
import {
  bookDetailHandlers,
  failing,
  hanging,
  physicalHandlers,
  readStatusHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import {
  aWireAlignment,
  aWireBook,
  aWireFile,
  aWireHighlight,
  aWireInsights,
  aWireOtherReview,
  aWirePosition,
  aWireProgress,
  aWireReadStatus,
  aWireReview,
  aWireSeries,
  aWireWishlist,
  WIRE_ADA,
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

/** Where the router is, for a play to read after a menu item navigates. */
function Location() {
  const { pathname, state } = useLocation();
  return (
    <output data-testid="location" data-from-book={String(state?.fromBook)}>
      {pathname}
    </output>
  );
}

/** The hero under the page's one queue of writes and its toasts, inside the stage's dark scope. */
function HeroInPage(props: Omit<ComponentProps<typeof Hero>, "rating">) {
  const rating = useMyRating(props.book.uuid);
  return (
    <ToastProvider>
      <div className="bp-root">
        <div className="bp-stage">
          <div className="bp-stage-body">
            <Hero {...props} rating={rating} />
          </div>
        </div>
      </div>
      <Location />
    </ToastProvider>
  );
}

const meta = {
  title: "Pages/BookDetail/Hero",
  component: HeroInPage,
  args: {
    book: aBook(),
    onShowSeries: fn(),
    onOpenReviews: fn(),
    onOpenDialog: fn(),
    onLeaveReview: fn(),
  },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook()));
  },
} satisfies Meta<typeof HeroInPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const writes: ReviewPatch[] = [];

/** A star button, once your saved rating is known: until it is, they are disabled. */
const starButton = async (canvas: ReturnType<typeof within>, name: string) => {
  const button = await canvas.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

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

let seriesAsked = false;

export const TheHeroNeverAsksForTheSeries: Story = {
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

export const WishlistOnlyBookDoesNotLinkItsAuthors: Story = {
  args: { book: aBook({ formats: [], book_files: [], has_physical: false }) },
  play: async ({ canvas }) => {
    const byline = canvas.getByTestId("book-authors");

    await expect(byline).toHaveTextContent("Sora Inkwell");
    await expect(within(byline).queryByRole("link")).not.toBeInTheDocument();
    await expect(byline.querySelector(".bd-author-link")).toBeNull();
  },
};

export const BookWithAFileLinksItsAuthors: Story = {
  play: async ({ canvas }) => {
    await expect(
      within(canvas.getByTestId("book-authors")).getByRole("link", {
        name: "Sora Inkwell",
      }),
    ).toHaveAttribute("href", "/authors/2");
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
  },
};

export const TheHouseholdAverageSitsBesideYourStars: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...reviewHandlers({
        mine: aWireReview({ stars: 4 }),
        others: [
          aWireOtherReview({ user_id: 7, username: "grace", stars: 4.5 }),
          aWireOtherReview({ user_id: 8, username: "linus", stars: 3 }),
          // Said something but gave no stars: not counted.
          aWireOtherReview({ user_id: 9, username: "tove", stars: null }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("group", { name: "Your rating" }),
    ).toBeInTheDocument();
    const household = await canvas.findByRole("group", {
      name: "Household average",
    });
    await expect(
      within(household).getByRole("img", { name: "3.8 out of 5 stars" }),
    ).toBeInTheDocument();
    await expect(
      within(household).getByRole("button", { name: "3 reviews" }),
    ).toBeInTheDocument();
  },
};

export const NoHouseholdAverageWhenNobodyRated: Story = {
  beforeEach({ msw }) {
    msw.use(...reviewHandlers({}));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("group", { name: "Your rating" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
        "Not rated yet",
      ),
    );
    await expect(
      canvas.queryByRole("group", { name: "Household average" }),
    ).not.toBeInTheDocument();
  },
};

export const RatingCountsTowardTheHouseholdAverage: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(
      ...reviewHandlers(
        {
          others: [
            aWireOtherReview({ user_id: 7, username: "grace", stars: 5 }),
          ],
        },
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await starButton(canvas, "Rate 4 stars"));

    const household = await canvas.findByRole("group", {
      name: "Household average",
    });
    await expect(
      within(household).getByRole("img", { name: "4.5 out of 5 stars" }),
    ).toBeInTheDocument();
    await expect(
      within(household).getByRole("button", { name: "2 reviews" }),
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

    await userEvent.click(await starButton(canvas, "Rate 3.5 stars"));

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
    const rated = await starButton(canvas, "Clear your 3-star rating");
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

export const NoHouseholdAverageForOneRating: Story = {
  beforeEach({ msw }) {
    msw.use(...reviewHandlers({ mine: aWireReview({ stars: 4 }) }));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
        "You rated it 4",
      ),
    );
    // One reader's stars are not an average.
    await expect(
      canvas.queryByRole("group", { name: "Household average" }),
    ).not.toBeInTheDocument();
  },
};

export const TheReviewCountOpensTheReviewsTab: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...reviewHandlers({
        mine: aWireReview({ stars: 4 }),
        others: [aWireOtherReview({ user_id: 7, username: "grace", stars: 5 })],
      }),
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "2 reviews" }),
    );

    await expect(args.onOpenReviews).toHaveBeenCalledOnce();
  },
};

/** Opens the More menu and names its items. */
async function moreItems(
  canvas: ReturnType<typeof within>,
  userEvent: { click: (element: Element) => Promise<void> },
) {
  await userEvent.click(canvas.getByRole("button", { name: "More actions" }));
  const menu = await canvas.findByRole("menu", { name: "More actions" });
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

export const OneEpub: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("link", { name: "Start reading" }),
    ).toHaveAttribute("href", `/read/${UUID}`);
    await expect(await moreItems(canvas, userEvent)).not.toContain("Immersive");
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
      await canvas.findByRole("button", { name: "Start reading" }),
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
    // The button is named by what it says, not by a label of its own that hides it.
    const trigger = await canvas.findByRole("button", {
      name: "Start reading",
    });
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(trigger);

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
      await canvas.findByRole("link", { name: "Start reading" }),
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
      await canvas.findByRole("link", { name: "Start reading" }),
    ).toHaveAttribute("href", `/pdf/${UUID}`);
  },
};

export const AudioOnly: Story = {
  args: { book: aBook({ formats: ["M4B"], book_files: [AUDIO] }) },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Start listening" }),
    ).toHaveAttribute("href", `/listen/${UUID}`);
    await expect(
      canvas.queryByRole("link", { name: "Listen" }),
    ).not.toBeInTheDocument();
  },
};

export const AudiobookOnlyHasNoReadAction: Story = {
  args: { book: aBook({ formats: ["M4B"], book_files: [AUDIO] }) },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Start listening" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: /Start reading|Read again/ }),
    ).not.toBeInTheDocument();
  },
};

export const EbookAndAudio: Story = {
  args: {
    book: aBook({ formats: ["EPUB", "M4B"], book_files: [EPUB, AUDIO] }),
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("link", { name: "Start reading" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Listen" })).toHaveAttribute(
      "href",
      `/listen/${UUID}`,
    );
    await expect(await moreItems(canvas, userEvent)).toContain("Immersive");
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
      await canvas.findByRole("button", { name: "Start listening" }),
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

/** Five chapters opening at 0, 15, 40, 70 and 85 percent of the book. */
const FIVE_CHAPTERS = [0, 15, 40, 70, 85].map((percent, i) => ({
  title: `Chapter ${i + 1}`,
  percent,
  spine_index: i * 2,
}));

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

/** The fill's progress, as set on the Continue button. */
const continueProgress = (canvasElement: HTMLElement) =>
  canvasElement
    .querySelector<HTMLElement>(".bp-continue-fill")
    ?.style.getPropertyValue("--bp-progress");

export const ContinueNamesTheChapterAndFillsToTheProgress: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 62 })),
      ),
      getGetAlignmentMockHandler200(
        aWireAlignment({
          ebook: { total_chars: 1000, chapters: FIVE_CHAPTERS },
        }),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole("link", { name: "Continue · Chapter 3" }),
    ).toHaveAttribute("href", `/read/${UUID}`);
    await expect(continueProgress(canvasElement)).toBe("62%");
  },
};

export const NotStartedShowsTheRuntime: Story = {
  args: { book: aBook({ formats: ["M4B"], book_files: [AUDIO] }) },
  beforeEach({ msw }) {
    msw.use(
      getGetAlignmentMockHandler200(
        aWireAlignment({
          audio_files: [
            {
              book_file_id: 21,
              duration_seconds: 21_420,
              chapter_starts: [],
              label: "a.m4b",
            },
          ],
        }),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByText("Audiobook · 5 h 57 m"),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
    await expect(continueProgress(canvasElement)).toBe("0%");
  },
};

export const ChapterBarFlagsTheChapterAndTimeLeft: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
      // 15,174 s in at 62%: 38% more is 2 h 35 m.
      getGetBookInsightsMockHandler200(
        aWireInsights({ seconds_total: 15_174 }),
      ),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 62 })),
      ),
      getGetAlignmentMockHandler200(
        aWireAlignment({
          ebook: { total_chars: 1000, chapters: FIVE_CHAPTERS },
        }),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const bar = await canvas.findByRole("progressbar", {
      name: "Reading progress",
    });
    await expect(bar).toHaveAttribute("aria-valuetext", "62%, chapter 3 of 5");
    await expect(bar).toHaveAttribute("aria-valuenow", "62");
    await expect(within(bar).getByText("Ch. 3")).toBeInTheDocument();
    await expect(
      await canvas.findByText(/about 2 h 35 m left at your pace/),
    ).toBeInTheDocument();
    // Five chapters, the first two behind the reader and the third part way.
    const segments = [...canvasElement.querySelectorAll(".bp-seg")];
    await expect(segments.map((seg) => seg.className)).toEqual([
      "bp-seg is-done",
      "bp-seg is-done",
      "bp-seg is-current",
      "bp-seg is-ahead",
      "bp-seg is-ahead",
    ]);
  },
};

const pillName = (status: string) => ({ name: `Read status: ${status}` });

const statusWrites: { status: string }[] = [];

export const StatusMenuSavesTheChoice: Story = {
  beforeEach({ msw }) {
    statusWrites.length = 0;
    msw.use(...readStatusHandlers(null, statusWrites));
  },
  play: async ({ canvas, userEvent }) => {
    // The pill waits for the status to be read.
    const pill = await canvas.findByRole("button", pillName("Unread"));
    await waitFor(() => expect(pill).toBeEnabled());

    await userEvent.click(pill);
    await userEvent.click(
      await canvas.findByRole("menuitemradio", { name: "Finished" }),
    );

    await waitFor(() =>
      expect(statusWrites).toEqual([{ book_uuid: UUID, status: "finished" }]),
    );
    await expect(
      await canvas.findByRole("button", pillName("Finished")),
    ).toBeInTheDocument();
  },
};

export const StatusSaveFailureToastsAndReverts: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("put", "/api/read-status", 500),
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", pillName("Reading")),
    );

    await userEvent.click(
      await canvas.findByRole("menuitemradio", { name: "Finished" }),
    );

    await expect(
      await canvas.findByText("Couldn’t save your reading status"),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("button", pillName("Reading")),
    ).toBeInTheDocument();
  },
};

export const ReadStatusNotStarted: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", pillName("Unread")),
    ).toBeEnabled();
  },
};

export const ReadStatusReading: Story = {
  beforeEach({ msw }) {
    msw.use(...readStatusHandlers(aWireReadStatus({ status: "reading" })));
  },
  play: async ({ canvas, userEvent }) => {
    const pill = await canvas.findByRole("button", pillName("Reading"));

    await userEvent.click(pill);

    await expect(
      await canvas.findByRole("menuitemradio", { name: "Reading" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      canvas.getByRole("menuitemradio", { name: "Unread" }),
    ).toHaveAttribute("aria-checked", "false");
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
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", pillName("Finished")),
    );

    await expect(
      await canvas.findByRole("menuitemradio", { name: /Finished/ }),
    ).toHaveTextContent("3 hours ago");
  },
};

export const ReadStatusClaimsNothingWhileItLoads: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/read-status/:uuid"));
  },
  play: async ({ canvas }) => {
    const pill = await canvas.findByRole("button", pillName("loading"));
    await expect(pill).toBeDisabled();
    await expect(pill).not.toHaveTextContent("Unread");
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
      await canvas.findByText("Couldn’t load your reading status"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", pillName("loading")),
    ).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await expect(
      await canvas.findByRole("button", pillName("Reading")),
    ).toBeEnabled();
  },
};

export const MoreMenuOffersTheBooksActions: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(await moreItems(canvas, userEvent)).toEqual([
      "Add to shelf",
      "Edit metadata",
      "Merge with…",
      "Delete files…",
    ]);

    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Add to shelf" }),
    );
    await expect(args.onOpenDialog).toHaveBeenLastCalledWith("shelf");

    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Merge with…" }),
    );
    await expect(args.onOpenDialog).toHaveBeenLastCalledWith("merge");

    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete files…" }),
    );
    await expect(args.onOpenDialog).toHaveBeenLastCalledWith("delete");
  },
};

export const MoreMenuLeavesMergeAndDeleteToAdmins: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false } },
  play: async ({ canvas, userEvent }) => {
    await expect(await moreItems(canvas, userEvent)).toEqual([
      "Add to shelf",
      "Edit metadata",
    ]);
  },
};

export const MoreMenuOffersDeleteRecordButNotMergeWithoutFiles: Story = {
  args: { book: aBook({ formats: [], book_files: [] }) },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({}));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await moreItems(canvas, userEvent)).toEqual([
      "Add to shelf",
      "Edit metadata",
      "Delete record…",
    ]);
  },
};

export const MoreMenuEditOpensTheEditor: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));

    await userEvent.click(
      await canvas.findByRole("menuitem", { name: "Edit metadata" }),
    );

    const where = await canvas.findByTestId("location");
    await expect(where).toHaveTextContent(`/books/${UUID}/edit`);
    await expect(where).toHaveAttribute("data-from-book", "true");
  },
};

export const MoreMenuClosesOnEscapeAndHandsFocusBack: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "More actions" });
    await userEvent.click(trigger);
    const first = await canvas.findByRole("menuitem", { name: "Add to shelf" });
    await waitFor(() => expect(first).toHaveFocus());

    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("menuitem", { name: "Edit metadata" }),
    ).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};

export const MoreMenuArrowUpFromNoItemGoesToTheLast: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));
    const menu = await canvas.findByRole("menu", { name: "More actions" });
    await waitFor(() =>
      expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus(),
    );
    // Focus on the menu itself, as after a click on its padding.
    menu.focus();

    await userEvent.keyboard("{ArrowUp}");

    await expect(within(menu).getAllByRole("menuitem").at(-1)).toHaveFocus();
  },
};

export const ResumeNamesTheChapter: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
      getGetProgressMockHandler200(
        aWireProgress(
          aWirePosition({
            progress_percent: 45,
            epub_cfi: "epubcfi(/6/6!/4/2/1:0)",
          }),
        ),
      ),
      getGetAlignmentMockHandler200(
        aWireAlignment({ ebook: { total_chars: 1000, chapters: CHAPTERS } }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Continue · Chapter 2" }),
    ).toBeInTheDocument();
    const bar = canvas.getByRole("progressbar");
    await expect(bar).toHaveAttribute("aria-valuetext", "45%, chapter 2 of 3");
    await expect(within(bar).getByText("Ch. 2")).toBeInTheDocument();
  },
};

export const ResumeWithoutAChapterTable: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 45 })),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole("link", { name: "Continue reading" }),
    ).toBeInTheDocument();
    // No chapters: one bar for the whole book, filled to where the reader is.
    await expect(canvas.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "45%",
    );
    await expect(canvasElement.querySelectorAll(".bp-seg")).toHaveLength(1);
  },
};

export const NotStartedHasNoRuler: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Start reading" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
  },
};

export const FinishedBook: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "finished" })),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 100 })),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole("link", { name: "Read again" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
    await expect(continueProgress(canvasElement)).toBe("100%");
  },
};

export const ListeningResumes: Story = {
  args: { book: aBook({ formats: ["M4B"], book_files: [AUDIO] }) },
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
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
      await canvas.findByRole("link", { name: "Continue listening" }),
    ).toBeInTheDocument();
    const bar = await canvas.findByRole("progressbar", {
      name: "Listening progress",
    });
    // The timeline arrives with the alignment, after the position.
    await waitFor(() =>
      expect(bar).toHaveAttribute(
        "aria-valuetext",
        "50%, 1 h 30 m left of 3 h",
      ),
    );
    await expect(within(bar).getByText("1 h 30 m")).toBeInTheDocument();
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
      canvas.getByText(/Tracking since Oct 9th, 2025|Tracking since October/),
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

export const RulerEstimatesTimeLeftAtTheReadersPace: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
      getGetBookInsightsMockHandler200(aWireInsights({ seconds_total: 3600 })),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 40 })),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/about 1 h 30 m left at your pace/),
    ).toBeInTheDocument();
  },
};

export const RulerPrefersTheAudioTimelineToThePace: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(aWireReadStatus({ status: "reading" })),
      getGetBookInsightsMockHandler200(aWireInsights()),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 40 })),
      ),
      getGetAlignmentMockHandler200(ALIGNED),
    );
  },
  args: { book: DUAL },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/1 h 30 m left of 3 h/),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/at your pace/)).not.toBeInTheDocument();
  },
};

/** Local noon, so the calendar day reads the same in every zone. */
const noon = (month: number, day: number) =>
  new Date(2026, month - 1, day, 12).getTime() / 1000;

const volume = (n: number) =>
  aWireBook({
    id: n,
    title: `Aurora Station, Vol. ${n}`,
    series_index: String(n),
    unique_identifier:
      n === 1 ? UUID : `00000000-0000-4000-8000-00000000000${n}`,
    cover_url: null,
  });

/** The answers for a book finished on 18 October after 17 days, with highlights and the next volume waiting. */
const finishedHandlers = (reviews: Parameters<typeof reviewHandlers>[0]) => [
  ...readStatusHandlers(
    aWireReadStatus({ status: "finished", finished_at: noon(10, 18) }),
  ),
  ...reviewHandlers(reviews),
  getGetSeriesByIdMockHandler200(
    aWireSeries({ books: [volume(1), volume(2), volume(3)] }),
  ),
  getGetBookInsightsMockHandler200(
    aWireInsights({ started_at: noon(10, 2), sessions: 13 }),
  ),
  getGetHighlightsMockHandler200([
    aWireHighlight({ id: 1 }),
    aWireHighlight({ id: 2 }),
  ]),
];

export const FinishedCardShowsTotalsAndUpNext: Story = {
  beforeEach({ msw }) {
    msw.use(...finishedHandlers({ mine: aWireReview({ stars: 4 }) }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        name: "You finished Aurora Station, Vol. 1",
      }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByText("17 days · 13 sessions · 2 highlights"),
    ).toBeInTheDocument();
    const next = await canvas.findByRole("link", {
      name: /Up next: Aurora Station, Vol. 2/,
    });
    await expect(next).toHaveAttribute(
      "href",
      "/books/00000000-0000-4000-8000-000000000002",
    );
    await expect(next).toHaveTextContent("Book 2 of Aurora Station");
    await expect(
      canvas.queryByRole("button", { name: /Leave a review/ }),
    ).not.toBeInTheDocument();
  },
};

export const FinishedAndUnratedOffersAReview: Story = {
  beforeEach({ msw }) {
    msw.use(...finishedHandlers({}));
  },
  play: async ({ args, canvas, userEvent }) => {
    const leave = await canvas.findByRole("button", { name: /Leave a review/ });
    await expect(leave).toHaveTextContent(
      "Tell your household what you thought",
    );
    await expect(
      canvas.queryByRole("link", { name: /Up next/ }),
    ).not.toBeInTheDocument();

    await userEvent.click(leave);

    await expect(args.onLeaveReview).toHaveBeenCalledOnce();
  },
};

export const RatingFlipsTheCardToUpNext: Story = {
  beforeEach({ msw }) {
    msw.use(...finishedHandlers({}));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("button", { name: /Leave a review/ });

    await userEvent.click(await starButton(canvas, "Rate 4 stars"));

    await expect(
      await canvas.findByRole("link", {
        name: /Up next: Aurora Station, Vol. 2/,
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: /Leave a review/ }),
    ).not.toBeInTheDocument();
  },
};

export const FinishedCardOffersNothingWhileTheReviewsLoad: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/reviews/:uuid"), ...finishedHandlers({}));
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: /You finished/ });
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(
      canvas.queryByRole("button", { name: /Leave a review/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: /Up next/ }),
    ).not.toBeInTheDocument();
  },
};

export const FinishedAndRatedWithoutASeriesOffersNothing: Story = {
  beforeEach({ msw }) {
    msw.use(...finishedHandlers({ mine: aWireReview({ stars: 5 }) }));
  },
  args: { book: aBook({ series: null, series_id: null, series_index: null }) },
  play: async ({ canvas }) => {
    // Your rating has loaded, so an empty card means nothing was offered.
    await canvas.findByText(/You rated it/);
    const card = within(
      await canvas.findByRole("region", { name: /You finished/ }),
    );

    await expect(card.queryByRole("button")).not.toBeInTheDocument();
    await expect(card.queryByRole("link")).not.toBeInTheDocument();
  },
};

export const FinishingPlaysTheBurstOnce: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(null),
      ...reviewHandlers({ mine: aWireReview({ stars: 4 }) }),
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const burst = canvasElement.querySelector(".bp-burst");
    await expect(burst).not.toHaveAttribute("data-playing");

    const pill = await canvas.findByRole("button", pillName("Unread"));
    await waitFor(() => expect(pill).toBeEnabled());
    await userEvent.click(pill);
    await userEvent.click(
      await canvas.findByRole("menuitemradio", { name: "Finished" }),
    );

    await waitFor(() => expect(burst).toHaveAttribute("data-playing"));
    await expect(
      await canvas.findByRole("heading", { name: /You finished/ }),
    ).toBeInTheDocument();
    // It plays for two seconds, once.
    await waitFor(() => expect(burst).not.toHaveAttribute("data-playing"), {
      timeout: 4000,
    });
  },
};

export const AFinishedBookOpensWithoutTheBurst: Story = {
  beforeEach({ msw }) {
    msw.use(...finishedHandlers({ mine: aWireReview({ stars: 4 }) }));
  },
  play: async ({ canvas, canvasElement }) => {
    const card = (
      await canvas.findByRole("heading", { name: /You finished/ })
    ).closest("section");
    await expect(card).not.toHaveClass("is-entering");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(canvasElement.querySelector(".bp-burst")).not.toHaveAttribute(
      "data-playing",
    );
  },
};

let reviewsRead = false;

export const NoHouseholdAverageWithoutAServerSummary: Story = {
  beforeEach({ msw }) {
    reviewsRead = false;
    msw.use(
      http.get("/api/reviews/:uuid", () => {
        reviewsRead = true;
        // Two raters, but the threshold is the server's: no summary sent.
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
    await waitFor(() =>
      expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
        "You rated it 5",
      ),
    );
    // The threshold is the server's, never recomputed here.
    await expect(
      canvas.queryByRole("group", { name: "Household average" }),
    ).not.toBeInTheDocument();
  },
};

// ---------- Round 1 ----------

const PHONE = {
  phone: { name: "Phone", styles: { width: "390px", height: "844px" } },
};

export const StatusMenuStaysInsideThePhoneScreen: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: { viewport: { options: PHONE } },
  play: async ({ canvas, userEvent }) => {
    const pill = await canvas.findByRole("button", pillName("Unread"));
    await waitFor(() => expect(pill).toBeEnabled());
    await userEvent.click(pill);

    const menu = await canvas.findByRole("menu", { name: "Read status" });
    await waitFor(() => expect(getComputedStyle(menu).opacity).toBe("1"));
    // An ebook alone puts the pill in the first column, so the menu must open to the right of its edge.
    await waitFor(() => {
      const { left, right } = menu.getBoundingClientRect();
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(window.innerWidth);
    });
  },
};

/** `window.matchMedia` answering as a reader who asked for less motion, or has a pointer that hovers, would. */
function stubMedia({ reduced, fine }: { reduced: boolean; fine: boolean }) {
  const real = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion")
      ? reduced
      : query.includes("hover: hover")
        ? fine
        : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = real;
  };
}

const pointerOver = (canvasElement: HTMLElement, type: string) =>
  canvasElement
    .querySelector(".bp-stage")
    ?.dispatchEvent(
      new PointerEvent(type, { clientX: 40, clientY: 40, bubbles: true }),
    );

const bookOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>(".bp-book") as HTMLElement;

export const ReducedMotionSkipsTheBurst: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(null),
      ...reviewHandlers({ mine: aWireReview({ stars: 4 }) }),
    );
    return stubMedia({ reduced: true, fine: true });
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const pill = await canvas.findByRole("button", pillName("Unread"));
    await waitFor(() => expect(pill).toBeEnabled());
    await userEvent.click(pill);
    await userEvent.click(
      await canvas.findByRole("menuitemradio", { name: "Finished" }),
    );

    await expect(
      await canvas.findByRole("heading", { name: /You finished/ }),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector(".bp-burst")).not.toHaveAttribute(
      "data-playing",
    );
  },
};

export const ReducedMotionLeavesTheCoverAtRest: Story = {
  beforeEach: () => stubMedia({ reduced: true, fine: true }),
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("heading", { level: 1 });

    pointerOver(canvasElement, "pointermove");

    await expect(bookOf(canvasElement).style.getPropertyValue("--ry")).toBe("");
  },
};

export const ACoarsePointerLeavesTheCoverAtRest: Story = {
  beforeEach: () => stubMedia({ reduced: false, fine: false }),
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("heading", { level: 1 });

    pointerOver(canvasElement, "pointermove");

    await expect(bookOf(canvasElement).style.getPropertyValue("--ry")).toBe("");
  },
};

export const AFinePointerLeansTheCoverAndLeavingRestsIt: Story = {
  beforeEach: () => stubMedia({ reduced: false, fine: true }),
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("heading", { level: 1 });

    pointerOver(canvasElement, "pointermove");
    await expect(bookOf(canvasElement).style.getPropertyValue("--ry")).not.toBe(
      "",
    );

    pointerOver(canvasElement, "pointerleave");
    await expect(bookOf(canvasElement).style.getPropertyValue("--ry")).toBe("");
  },
};

const SQUARE_UUID = "00000000-0000-4000-8000-00000000a0a0";

/** A 200 by 200 cover, an audiobook's. */
const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#8a3b2a"/></svg>`;

export const ASquareCoverMarksTheBookSquare: Story = {
  // Its own address, since the browser keeps the image an earlier story loaded from the shared one.
  args: { book: aBook({ unique_identifier: SQUARE_UUID }) },
  beforeEach({ msw }) {
    msw.use(
      http.get(
        "/api/covers/:uuid",
        () =>
          new HttpResponse(SQUARE, {
            headers: { "Content-Type": "image/svg+xml" },
          }),
      ),
    );
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(bookOf(canvasElement)).toHaveAttribute("data-shape", "square"),
    );
  },
};

export const TheCoverReservesItsSpaceBeforeItLoads: Story = {
  play: async ({ canvas }) => {
    const cover = await canvas.findByRole("img", { name: /^Cover of/ });

    await expect(cover).toHaveAttribute("width", "340");
    await expect(cover).toHaveAttribute("height", "510");
  },
};

export const ARefusedFinishedSaveEndsTheCelebration: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("put", "/api/read-status", 500),
      ...readStatusHandlers(null),
      ...reviewHandlers({ mine: aWireReview({ stars: 4 }) }),
    );
    return stubMedia({ reduced: false, fine: true });
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const pill = await canvas.findByRole("button", pillName("Unread"));
    await waitFor(() => expect(pill).toBeEnabled());
    await userEvent.click(pill);
    await userEvent.click(
      await canvas.findByRole("menuitemradio", { name: "Finished" }),
    );
    await canvas.findByText("Couldn’t save your reading status");

    // The book is not finished, so nothing celebrates it: not the burst, not the card.
    await waitFor(
      () =>
        expect(canvasElement.querySelector(".bp-burst")).not.toHaveAttribute(
          "data-playing",
        ),
      { timeout: 1000 },
    );
    await expect(
      canvas.queryByRole("heading", { name: /You finished/ }),
    ).not.toBeInTheDocument();
  },
};

export const NothingStatusDependentWhileTheStatusLoads: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/read-status/:uuid"));
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("heading", { level: 1 });

    // No runtime or bar and no card, and the button says only what it will always do.
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
    await expect(canvasElement.querySelector(".bp-runtime")).toBeNull();
    await expect(
      canvas.queryByRole("heading", { name: /You finished/ }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByTestId("start-reading")).toHaveTextContent("Read");
    await expect(canvas.getByTestId("start-reading")).not.toHaveTextContent(
      /Start|Continue|again/,
    );
  },
};

export const NoSavedStatusIsUnreadWhateverThePositionsSay: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(null),
      getGetProgressMockHandler200(
        aWireProgress(aWirePosition({ progress_percent: 62 })),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", pillName("Unread")),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("link", { name: "Start reading" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
  },
};

export const StarsWaitForTheSavedRating: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(hanging("/api/reviews/:uuid"), ...reviewHandlers({}, writes));
  },
  play: async ({ canvas, userEvent }) => {
    const group = await canvas.findByRole("group", { name: "Your rating" });
    const first = within(group).getByRole("button", { name: "Rate 0.5 stars" });

    // Not rated yet is a claim it cannot make, and a click would write over what it cannot see.
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "Loading your rating…",
    );
    await expect(first).toBeDisabled();
    await userEvent.click(first);
    await expect(writes).toEqual([]);
  },
};

export const StarsSayWhenTheRatingCouldNotBeRead: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/reviews/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Couldn’t load your rating"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Rate 0.5 stars" }),
    ).toBeDisabled();
  },
};

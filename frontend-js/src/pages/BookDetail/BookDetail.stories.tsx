import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import {
  getGetAlignmentMockHandler200,
  getGetBookInsightsMockHandler200,
  getGetEbookByUuidMockHandler404,
  getGetProgressMockHandler200,
  getGetSeriesByIdMockHandler200,
  getPostEbookOverridesMockHandler200,
} from "../../api/generated/omnibus.msw";
import type { ReviewPatch } from "../../api/generated/schemas";
import {
  bookDetailHandlers,
  deletionHandlers,
  failing,
  highlightsHandlers,
  journalHandlers,
  mergeHandlers,
  physicalHandlers,
  readStatusHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import {
  aWireAlignment,
  aWireAudiobook,
  aWireBook,
  aWireFile,
  aWireHighlight,
  aWireInsights,
  aWireJournalEntry,
  aWireManifest,
  aWireOtherReview,
  aWirePosition,
  aWireProgress,
  aWireReadStatus,
  aWireReview,
  aWireSeries,
  WIRE_ADA,
} from "../../testing/wire";
import { BookDetail } from "./BookDetail";

const BOOK = aWireBook({
  series_id: 4,
  formats: ["EPUB"],
  book_files: [aWireFile()],
  genres: ["Science fiction"],
  subjects: ["Space opera", "First contact"],
  description: `<p>${"A station at the edge of the map hears something answer. ".repeat(6)}</p>`,
});

const writes: string[] = [];
const reads: string[] = [];

const meta = {
  title: "Pages/BookDetail",
  component: BookDetail,
  parameters: { path: `/books/${BOOK.unique_identifier}` },
  beforeEach() {
    writes.length = 0;
  },
  // The page reads its uuid from the route, as it does under the app router.
  render: () => (
    <Routes>
      <Route path="/books/:uuid" element={<BookDetail />} />
      <Route path="/" element={<p>The library</p>} />
    </Routes>
  ),
} satisfies Meta<typeof BookDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("book-authors")).toHaveTextContent(
      "Aurora Station, book 1",
    );
    await expect(canvas.getByText("First contact")).toBeInTheDocument();

    const toggle = canvas.getByRole("button", { name: "Show more" });
    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

const TAB_NAMES = [
  "Overview",
  "Reviews",
  "Highlights & Journal",
  "Files & Details",
];

export const TabsListTheFourSections: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas }) => {
    const tabs = await canvas.findAllByRole("tab");
    await expect(tabs.map((tab) => tab.textContent)).toEqual(TAB_NAMES);
    await expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    const panels = canvas.getAllByRole("tabpanel", { hidden: true });
    await expect(
      panels.map((panel) => panel.getAttribute("aria-labelledby")),
    ).toEqual(tabs.map((tab) => tab.id));
    await expect(panels.map((panel) => panel.hidden)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  },
};

export const ClickingATabShowsItsPanel: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const reviews = await canvas.findByRole("tab", { name: "Reviews" });

    await userEvent.click(reviews);

    await waitFor(() =>
      expect(reviews).toHaveAttribute("aria-selected", "true"),
    );
    await expect(canvas.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(
      canvas.getByRole("tabpanel", { name: "Reviews" }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector("#bp-panel-overview"),
    ).not.toBeVisible();
    await expect(canvasElement.querySelector(".bp-stage")).toHaveAttribute(
      "data-tab",
      "reviews",
    );
  },
};

export const HighlightsTabPutsPassagesBesideTheJournal: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
    msw.use(
      ...highlightsHandlers([aWireHighlight({ id: 1 })]),
      ...journalHandlers([aWireJournalEntry({ id: 1 })], WIRE_ADA.id),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("tab", { name: "Highlights & Journal" }),
    );

    const panel = await canvas.findByRole("tabpanel", {
      name: "Highlights & Journal",
    });
    await expect(
      await within(panel).findByRole("heading", { name: "Highlights 1" }),
    ).toBeVisible();
    await expect(
      await within(panel).findByRole("heading", { name: "Journal 1" }),
    ).toBeVisible();
    await expect(
      await within(panel).findByTestId("highlight-card"),
    ).toBeVisible();
    await expect(
      await within(panel).findByTestId("journal-entry"),
    ).toBeVisible();
  },
};

export const ArrowKeysMoveBetweenTabs: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    const tab = (name: string) => canvas.getByRole("tab", { name });
    (await canvas.findByRole("tab", { name: "Overview" })).focus();

    const selected = (name: string) =>
      waitFor(() => expect(tab(name)).toHaveAttribute("aria-selected", "true"));

    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(tab("Reviews")).toHaveFocus());
    await selected("Reviews");

    await userEvent.keyboard("{End}");
    await waitFor(() => expect(tab("Files & Details")).toHaveFocus());
    await selected("Files & Details");

    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(tab("Highlights & Journal")).toHaveFocus());
    await selected("Highlights & Journal");

    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(tab("Overview")).toHaveFocus());
    await selected("Overview");
    // Roving focus: only the open tab is in the tab order.
    await expect(tab("Reviews")).toHaveAttribute("tabindex", "-1");
  },
};

/** How far the ribbon's centre is from the open tab's. */
const ribbonOffset = (canvasElement: HTMLElement) => {
  const ribbon = canvasElement.querySelector(".bp-ribbon");
  const open = canvasElement.querySelector(
    '[role="tab"][aria-selected="true"]',
  );
  if (!ribbon || !open) throw new Error("the tab strip is not drawn");
  const [a, b] = [ribbon.getBoundingClientRect(), open.getBoundingClientRect()];
  return Math.abs(a.left + a.width / 2 - (b.left + b.width / 2));
};

export const RibbonSitsCentredUnderTheOpenTab: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByRole("tab", { name: "Overview" });
    await waitFor(() => expect(ribbonOffset(canvasElement)).toBeLessThan(1));

    await userEvent.click(canvas.getByRole("tab", { name: "Files & Details" }));
    await waitFor(() => expect(ribbonOffset(canvasElement)).toBeLessThan(1));

    // Moving the tabs inside the strip resizes it.
    const strip = canvas.getByRole("tablist", { name: "Book sections" });
    strip.style.paddingInlineStart = "160px";
    await waitFor(() => expect(ribbonOffset(canvasElement)).toBeLessThan(1));
  },
};

export const HouseholdRatingOpensTheReviewsTab: Story = {
  beforeEach({ msw }) {
    msw.use(
      // Ahead of the page's quiet answers, so the household has a rating.
      ...reviewHandlers({
        mine: aWireReview({ stars: 4 }),
        others: [aWireOtherReview({ stars: 5 })],
      }),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "See grace's review" }),
    );

    await waitFor(() =>
      expect(canvas.getByRole("tab", { name: "Reviews" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
  },
};

export const ChevronOpensThatReadersReview: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...reviewHandlers({
        mine: aWireReview({ stars: 4 }),
        others: [
          aWireOtherReview({ user_id: 7, username: "Maya R.", stars: 5 }),
          aWireOtherReview({
            user_id: 8,
            username: "Jordan K.",
            stars: 4,
            body_md: "Slow in the mines, then it takes off.",
            body_html: "<p>Slow in the mines, then it takes off.</p>",
          }),
        ],
      }),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "See Jordan K.'s review" }),
    );

    await waitFor(() =>
      expect(canvas.getByRole("tab", { name: "Reviews" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    const card = await canvas.findByRole("article", {
      name: "Jordan K.'s review",
    });
    await waitFor(() => expect(card).toHaveFocus());
    await waitFor(() => {
      const box = card.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    });
    // It glows for a moment, then rests.
    await expect(card).toHaveClass("is-flash");
    await waitFor(() => expect(card).not.toHaveClass("is-flash"), {
      timeout: 4000,
    });
  },
};

const patches: (ReviewPatch | "delete")[] = [];

export const AHeroTapShowsOnTheReviewsTabToo: Story = {
  beforeEach({ msw }) {
    patches.length = 0;
    msw.use(...reviewHandlers({}, patches), ...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    // Only the open tab's stars are in the accessibility tree: these are the hero's.
    const hero = await canvas.findByRole("group", { name: "Your rating" });

    const star = within(hero).getByRole("button", { name: "Rate 4 stars" });
    // Until your saved rating is read the stars wait.
    await waitFor(() => expect(star).toBeEnabled());
    await userEvent.click(star);
    await waitFor(() => expect(patches).toEqual([{ stars: 4 }]));
    await userEvent.click(canvas.getByRole("tab", { name: "Reviews" }));

    const card = await canvas.findByTestId("my-review");
    await expect(
      [...card.querySelectorAll<HTMLElement>(".bd-star-fg")].map(
        (fg) => fg.style.width,
      ),
    ).toEqual(["100%", "100%", "100%", "100%", "0%"]);
    await expect(patches).toEqual([{ stars: 4 }]);
  },
};

export const LeaveAReviewLandsOnTheRatingInTheReviewsTab: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(
        aWireReadStatus({ status: "finished", finished_at: 1_760_000_000 }),
      ),
      ...reviewHandlers({}),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: /Leave a review/ }),
    );

    await waitFor(() =>
      expect(canvas.getByRole("tab", { name: "Reviews" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    const reviews = canvas.getByRole("tabpanel", { name: "Reviews" });
    await waitFor(() =>
      expect(
        within(reviews).getByRole("group", { name: "Your rating" }),
      ).toContainElement(document.activeElement as HTMLElement),
    );
  },
};

const FOUND =
  "A station at the edge of the map hears something answer, and the crew must decide whether to reply.";

export const FetchSummaryReplacesASparseDescription: Story = {
  beforeEach({ msw }) {
    const sparse = aWireBook({ ...BOOK, description: "<p>Too short.</p>" });
    msw.use(
      ...bookDetailHandlers(sparse),
      http.get("/api/summary/sources", () =>
        HttpResponse.json(["GoogleBooks"]),
      ),
      http.post("/api/ebooks/:uuid/summary/fetch", () =>
        HttpResponse.json(FOUND),
      ),
      getPostEbookOverridesMockHandler200({
        ...sparse,
        description: `<p>${FOUND}</p>`,
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fetch Summary" }),
    );

    await expect(await canvas.findByText(FOUND)).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Fetch Summary" }),
    ).not.toBeInTheDocument();
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(getGetEbookByUuidMockHandler404());
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Book not found."),
    ).toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the book",
    );
  },
};

const NOT_ADMIN = { ...WIRE_ADA, is_admin: false };
const volume = aWireBook({
  id: 22,
  title: "Aurora Station, Vol. 2",
  unique_identifier: "00000000-0000-4000-8000-000000000002",
  formats: ["M4B"],
  cover_url: null,
});

export const AdminSeesMergeAndDelete: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("merge-with")).toHaveTextContent(
      "Merge with…",
    );
    await expect(canvas.getByTestId("delete-files")).toHaveTextContent(
      "Delete files…",
    );
  },
};

export const ReaderSeesNeither: Story = {
  parameters: { user: NOT_ADMIN },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("edit-metadata");
    await expect(canvas.queryByTestId("merge-with")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("delete-files")).not.toBeInTheDocument();
  },
};

export const FilelessRecordOffersDeleteRecordButNotMerge: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers({ ...BOOK, formats: [], book_files: [] }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("delete-files")).toHaveTextContent(
      "Delete record…",
    );
    await expect(canvas.queryByTestId("merge-with")).not.toBeInTheDocument();
  },
};

export const MergeThenUndo: Story = {
  beforeEach({ msw }) {
    msw.use(...mergeHandlers([volume], writes), ...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("tab", { name: "Files & Details" }),
    );
    await userEvent.click(await canvas.findByTestId("merge-with"));
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(await canvas.findByTestId("merge-candidate"));
    await userEvent.click(canvas.getByTestId("merge-confirm"));

    const merged = await canvas.findByText("Books merged");
    // The toast fades in.
    await waitFor(() => expect(merged).toBeVisible());
    await expect(canvas.queryByTestId("merge-dialog")).not.toBeInTheDocument();
    await expect(writes).toEqual([
      `merge:${volume.unique_identifier}>${BOOK.unique_identifier}`,
    ]);

    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(writes).toContain("undo:5"));
    await expect(await canvas.findByText("Merge undone")).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.queryByText("Books merged")).not.toBeInTheDocument(),
    );
  },
};

export const FailedUndoKeepsTheToastWithTheReason: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("post", "/api/books/merge/undo", 409),
      ...mergeHandlers([volume], writes),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("tab", { name: "Files & Details" }),
    );
    await userEvent.click(await canvas.findByTestId("merge-with"));
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(await canvas.findByTestId("merge-candidate"));
    await userEvent.click(canvas.getByTestId("merge-confirm"));
    await userEvent.click(await canvas.findByRole("button", { name: "Undo" }));

    await expect(
      await canvas.findByText(/Couldn.t undo the merge: failed with 409/),
    ).toBeInTheDocument();
    // The Undo is still on offer, to try again.
    const again = await canvas.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(again).toBeVisible());
  },
};

export const PartialDeleteRefetchesThePage: Story = {
  beforeEach({ msw }) {
    const both = aWireBook({
      ...BOOK,
      formats: ["EPUB", "PDF"],
      book_files: [aWireFile(), aWireFile({ id: 12, format: "PDF" })],
    });
    let reads = 0;
    msw.use(
      ...deletionHandlers(aWireManifest({ files: both.book_files }), writes),
      // The second read is the refetch, after the PDF went.
      http.get("/api/ebooks/:uuid", () =>
        HttpResponse.json(
          reads++ === 0
            ? both
            : { ...both, formats: ["EPUB"], book_files: [aWireFile()] },
        ),
      ),
      ...bookDetailHandlers(both),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("tab", { name: "Files & Details" }),
    );
    await canvas.findByTestId("format-row-pdf");
    await userEvent.click(await canvas.findByTestId("delete-files"));
    await userEvent.click(await canvas.findByTestId("delete-file-12"));
    await userEvent.click(canvas.getByTestId("delete-continue"));
    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await waitFor(() => expect(writes).toEqual(["delete:files=12;copies="]));
    await waitFor(() =>
      expect(
        canvas.queryByTestId("delete-book-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("format-row-pdf")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("format-row-epub")).toBeInTheDocument();
  },
};

export const TotalDeleteLeavesForTheLibrary: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...deletionHandlers(aWireManifest(), writes, true),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("tab", { name: "Files & Details" }),
    );
    await userEvent.click(await canvas.findByTestId("delete-files"));
    await userEvent.click(await canvas.findByTestId("delete-select-all"));
    await userEvent.click(canvas.getByTestId("delete-continue"));
    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await expect(await canvas.findByText("The library")).toBeInTheDocument();
  },
};

export const WishlistWriteRefetchesOnlyWhatItChanged: Story = {
  beforeEach({ msw }) {
    const fileless = aWireBook({ ...BOOK, formats: [], book_files: [] });
    reads.length = 0;
    msw.use(
      // Records every read, then lets the real handler answer.
      http.get("/api/*", ({ request }) => {
        reads.push(new URL(request.url).pathname);
      }),
      ...physicalHandlers({}, writes),
      ...bookDetailHandlers(fileless),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const add = await canvas.findByTestId("add-to-wishlist");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const before = reads.length;

    await userEvent.click(add);
    await canvas.findByTestId("wishlist-card");
    await new Promise((resolve) => setTimeout(resolve, 600));

    // The record, the copies and the wish, and the shelf facts that read it.
    // The record, the copies and the wish, and the shelf facts that read it: each exactly once.
    const uuid = BOOK.unique_identifier;
    await expect(reads.slice(before).sort()).toEqual(
      [
        `/api/ebooks/${uuid}`,
        `/api/physical/${uuid}/copies`,
        `/api/physical/${uuid}/wishlist`,
        "/api/shelves",
        `/api/shelves/containing/${uuid}`,
        `/api/shelves/containing/${uuid}/smart`,
      ].sort(),
    );
  },
};

const aliasReads: string[] = [];
const ALIAS = "00000000-0000-4000-8000-0000000000aa";

export const MergedAwayUuidMovesToTheSurvivingBook: Story = {
  parameters: { path: `/books/${ALIAS}` },
  beforeEach({ msw }) {
    aliasReads.length = 0;
    msw.use(
      // A merged-away uuid resolves to the book that absorbed it.
      http.get("/api/ebooks/:uuid", ({ params }) => {
        aliasReads.push(String(params.uuid));
        return HttpResponse.json(BOOK);
      }),
      ...bookDetailHandlers(BOOK),
    );
  },
  render: () => (
    <>
      <Routes>
        <Route path="/books/:uuid" element={<BookDetail />} />
      </Routes>
      <output data-testid="location">{useLocation().pathname}</output>
    </>
  ),
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "Aurora Station, Vol. 1" });

    await waitFor(() =>
      expect(canvas.getByTestId("location")).toHaveTextContent(
        `/books/${BOOK.unique_identifier}`,
      ),
    );
    // The survivor is seeded from the alias's answer: no second fetch, no loader.
    await expect(canvas.queryByText("Taking it off the shelf")).toBeNull();
    await expect(aliasReads).toEqual([ALIAS]);
  },
};

export const MergedAwayUuidKeepsTheRestOfTheAddressWhateverItsEncoding: Story =
  {
    // `%61` is "a": the route reads the uuid decoded, the address keeps it as typed.
    parameters: { path: "/books/00000000-0000-4000-8000-0000000000%61a/edit" },
    beforeEach({ msw }) {
      aliasReads.length = 0;
      msw.use(
        http.get("/api/ebooks/:uuid", ({ params }) => {
          aliasReads.push(String(params.uuid));
          return HttpResponse.json(BOOK);
        }),
        ...bookDetailHandlers(BOOK),
      );
    },
    render: () => (
      <>
        <Routes>
          <Route path="/books/:uuid/edit" element={<BookDetail />} />
        </Routes>
        <output data-testid="location">{useLocation().pathname}</output>
      </>
    ),
    play: async ({ canvas }) => {
      await canvas.findByRole("heading", { name: "Aurora Station, Vol. 1" });

      await waitFor(() =>
        expect(canvas.getByTestId("location")).toHaveTextContent(
          `/books/${BOOK.unique_identifier}/edit`,
        ),
      );
      await expect(aliasReads).toEqual([ALIAS]);
    },
  };

// ---------- The adaptive states, each tab, and the four themes ----------

const FIVE_CHAPTERS = [0, 15, 40, 70, 85].map((percent, i) => ({
  title: `Chapter ${i + 1}`,
  percent,
  spine_index: i * 2,
}));

/** Local noon, so the calendar day reads the same in every zone. */
const noon = (month: number, day: number) =>
  new Date(2026, month - 1, day, 12).getTime() / 1000;

const seriesVolume = (n: number) =>
  aWireBook({
    id: n,
    title: `Aurora Station, Vol. ${n}`,
    series_index: String(n),
    unique_identifier:
      n === 1
        ? BOOK.unique_identifier
        : `00000000-0000-4000-8000-00000000000${n}`,
    cover_url: null,
  });

/** Words a section shows while it waits, none of which may be left on a settled page. */
const LOADING =
  /Gathering|Finding|Tallying|Checking your shelves|Taking it off|Opening the record/;

/** Nothing is left waiting: a section that was loading has answered, with its content or its absence. */
const settled = (canvas: ReturnType<typeof within>) =>
  waitFor(() => expect(canvas.queryByText(LOADING)).not.toBeInTheDocument());

const heading = (canvas: ReturnType<typeof within>, name: string | RegExp) =>
  canvas.findByRole("heading", { name });

const openTab = async (
  canvas: ReturnType<typeof within>,
  userEvent: { click: (el: Element) => Promise<void> },
  name: string,
) => {
  await userEvent.click(await canvas.findByRole("tab", { name }));
  await waitFor(() =>
    expect(canvas.getByRole("tab", { name })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  return within(canvas.getByRole("tabpanel", { name }));
};

export const InProgressEbook: Story = {
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
      getGetBookInsightsMockHandler200(
        aWireInsights({ seconds_total: 15_174 }),
      ),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Continue · Chapter 3" }),
    ).toHaveAttribute("href", `/read/${BOOK.unique_identifier}`);
    const bar = await canvas.findByRole("progressbar", {
      name: "Reading progress",
    });
    await expect(bar).toHaveAttribute("aria-valuenow", "62");
    await expect(
      canvas.getByRole("button", { name: "Read status: Reading" }),
    ).toBeInTheDocument();
    await expect(await heading(canvas, "Your reading")).toBeInTheDocument();
    await settled(canvas);
  },
};

const DRACULA = aWireAudiobook();

export const NotStartedAudiobook: Story = {
  parameters: { path: `/books/${DRACULA.unique_identifier}` },
  beforeEach({ msw }) {
    msw.use(
      getGetAlignmentMockHandler200(
        aWireAlignment({
          audio_files: [
            {
              book_file_id: 41,
              duration_seconds: 21_420,
              chapter_starts: [],
              label: "Dracula - Bram Stoker.m4b",
            },
          ],
        }),
      ),
      ...bookDetailHandlers(DRACULA),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Dracula" }),
    ).toBeInTheDocument();
    // The runtime stands where a progress bar would, and the action is to start, by listening.
    await expect(
      await canvas.findByText("Audiobook · 5 h 57 m"),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("link", { name: "Start listening" }),
    ).toHaveAttribute("href", `/listen/${DRACULA.unique_identifier}`);
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: /Start reading|Continue|Read again/ }),
    ).not.toBeInTheDocument();

    // Nothing to say about a series or other books by Stoker, so no section says it.
    await expect(
      canvas.getByText(
        "No listening recorded yet. Time and sessions appear after you start listening.",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { name: /^More by/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { name: / series$/ }),
    ).not.toBeInTheDocument();
    await settled(canvas);

    const reviews = await openTab(canvas, userEvent, "Reviews");
    await expect(
      await reviews.findByRole("heading", {
        name: "No ratings or reviews yet",
      }),
    ).toBeInTheDocument();
    // Your review is still there to write.
    await expect(
      reviews.getByRole("group", { name: "Your rating" }),
    ).toBeInTheDocument();

    const journal = await openTab(canvas, userEvent, "Highlights & Journal");
    await expect(
      await journal.findByRole("heading", {
        name: "No highlights or journal entries",
      }),
    ).toBeInTheDocument();
    await expect(
      journal.getByRole("button", { name: "New journal entry" }),
    ).toBeInTheDocument();

    // The details the file does not carry read as unset, each with a way to add it.
    const files = await openTab(canvas, userEvent, "Files & Details");
    await expect(files.getAllByText("Not set")).toHaveLength(4);
    await expect(
      files.getByRole("link", { name: "Add publisher" }),
    ).toHaveAttribute(
      "href",
      `/books/${DRACULA.unique_identifier}/edit?field=publisher`,
    );
    await expect(
      files.getByText("Dracula - Bram Stoker.m4b"),
    ).toBeInTheDocument();
    await settled(canvas);
  },
};

export const Finished: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(
        aWireReadStatus({ status: "finished", finished_at: noon(10, 18) }),
      ),
      ...reviewHandlers({ mine: aWireReview({ stars: 4 }) }),
      getGetSeriesByIdMockHandler200(
        aWireSeries({
          books: [seriesVolume(1), seriesVolume(2), seriesVolume(3)],
        }),
      ),
      getGetBookInsightsMockHandler200(
        aWireInsights({ started_at: noon(10, 2), sessions: 13 }),
      ),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        name: "You finished Aurora Station, Vol. 1",
      }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("link", {
        name: /Up next: Aurora Station, Vol. 2/,
      }),
    ).toHaveAttribute("href", "/books/00000000-0000-4000-8000-000000000002");
    await expect(
      canvas.getByRole("button", { name: "Read status: Finished" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
  },
};

export const JournalComposerFromTheFinishedCardCoversTheTabs: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...readStatusHandlers(
        aWireReadStatus({ status: "finished", finished_at: noon(10, 18) }),
      ),
      ...reviewHandlers({ mine: aWireReview({ stars: 4 }) }),
      ...bookDetailHandlers(
        aWireBook({
          ...BOOK,
          series: null,
          series_id: null,
          series_index: null,
        }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: /New journal entry/ }),
    );
    const overlay = await canvas.findByTestId("journal-composer-overlay");

    const tabs = canvas.getByRole("tablist");
    tabs.scrollIntoView({ block: "center" });
    const box = tabs.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );

    // The strip is behind the dimmed overlay, not drawn over the editor's backdrop.
    await expect(overlay.contains(top)).toBe(true);
  },
};

export const EmptyHousehold: Story = {
  beforeEach({ msw }) {
    msw.use(...reviewHandlers({}), ...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("group", { name: "Your rating" }),
    ).toBeInTheDocument();
    // The reviews and the household have answered, so what is missing is absent, not pending.
    await waitFor(() =>
      expect(canvas.getAllByTestId("review-stars-meta")[0]).toHaveTextContent(
        "Not rated yet",
      ),
    );
    await expect(await heading(canvas, "Your reading")).toBeInTheDocument();
    await settled(canvas);
    await expect(
      canvas.queryByRole("list", { name: "Household ratings" }),
    ).not.toBeInTheDocument();
    // No other reader has opened the book, so Your reading has no Household block.
    await expect(
      canvas.queryByRole("heading", { name: "Household" }),
    ).not.toBeInTheDocument();

    const reviews = await openTab(canvas, userEvent, "Reviews");
    await expect(
      await reviews.findByRole("heading", {
        name: "No ratings or reviews yet",
      }),
    ).toBeInTheDocument();
    await expect(
      reviews.queryByRole("heading", { name: /^Household/ }),
    ).not.toBeInTheDocument();
    await settled(canvas);
  },
};

export const OverviewTab: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas }) => {
    const panel = within(
      await canvas.findByRole("tabpanel", { name: "Overview" }),
    );
    await expect(canvas.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      await panel.findByRole("heading", { name: "Your reading" }),
    ).toBeVisible();
    await expect(panel.getByText("First contact")).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Show more" }),
    ).toBeVisible();
  },
};

export const ReviewsTabSelected: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await openTab(canvas, userEvent, "Reviews");

    await expect(
      await panel.findByRole("heading", { name: "Your review" }),
    ).toBeVisible();
    await expect(canvasHero(canvas)).toHaveAttribute("data-tab", "reviews");
  },
};

export const HighlightsTabSelected: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...highlightsHandlers([aWireHighlight({ id: 1 })]),
      ...journalHandlers([aWireJournalEntry({ id: 1 })], WIRE_ADA.id),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await openTab(canvas, userEvent, "Highlights & Journal");

    await expect(
      await panel.findByRole("heading", { name: "Highlights 1" }),
    ).toBeVisible();
    await expect(
      await panel.findByRole("heading", { name: "Journal 1" }),
    ).toBeVisible();
    await expect(canvasHero(canvas)).toHaveAttribute("data-tab", "highlights");
  },
};

export const FilesTabSelected: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    const panel = await openTab(canvas, userEvent, "Files & Details");

    await expect(
      await panel.findByRole("heading", { name: "Files" }),
    ).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Details" })).toBeVisible();
    await expect(
      await panel.findByRole("heading", { name: "Physical copies" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("group", { name: "Available formats" }),
    ).toBeVisible();
    await expect(canvasHero(canvas)).toHaveAttribute("data-tab", "files");
  },
};

/** The stage that carries `data-tab`. */
const canvasHero = (canvas: ReturnType<typeof within>) =>
  canvas.getByRole("banner");

const NO_COVER_NO_ACCENT = aWireBook({
  cover_url: null,
  accent: null,
  formats: ["EPUB"],
  book_files: [aWireFile()],
});

export const NoCoverNoAccent: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(NO_COVER_NO_ACCENT));
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 1,
        name: "Aurora Station, Vol. 1",
      }),
    ).toBeInTheDocument();
    // A typeset plate stands in for the cover, and the page takes the theme's accent.
    await expect(
      canvas.queryByRole("img", { name: /^Cover of/ }),
    ).not.toBeInTheDocument();
    const root = canvasElement.querySelector<HTMLElement>(".bp-root");
    await expect(root?.style.getPropertyValue("--accent")).toBe("");
    // Whatever that accent is, the fills derived from it still carry white text.
    const probe = document.createElement("span");
    probe.style.color = "var(--bp-accent-fill)";
    root?.append(probe);
    const fill = getComputedStyle(probe).color;
    probe.remove();
    await expect(
      Number(/oklch\(\s*([\d.]+)/.exec(fill)?.[1]),
    ).toBeLessThanOrEqual(0.6);
    await expect(
      await canvas.findByRole("link", { name: /Start reading|Continue/ }),
    ).toBeVisible();
    await settled(canvas);
  },
};

export const NoSeriesNoOtherTitles: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...bookDetailHandlers(
        aWireBook({
          series: null,
          series_index: null,
          formats: ["EPUB"],
          book_files: [aWireFile()],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await heading(canvas, "Your reading")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { name: / series$/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { name: /^More by/ }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("bp-series-fan")).not.toBeInTheDocument();
    await settled(canvas);
  },
};

/** What the colour `var(--ink-0)` is inside `scope`. */
const inkOf = (scope: Element) => {
  const probe = document.createElement("span");
  probe.style.color = "var(--ink-0)";
  scope.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
};

const heroStaysDark: Story["play"] = async ({ canvas, canvasElement }) => {
  const title = await canvas.findByRole("heading", {
    level: 1,
    name: "Aurora Station, Vol. 1",
  });
  const stage = canvasElement.querySelector(".bp-stage") as HTMLElement;
  const panel = (await canvas.findByRole("tabpanel", {
    name: "Overview",
  })) as HTMLElement;
  const reading = await within(panel).findByRole("heading", {
    name: "Your reading",
  });
  // The stage pins its own dark inks; below the tabs the theme's apply.
  await expect(getComputedStyle(title).color).toBe(inkOf(stage));
  await expect(getComputedStyle(reading).color).toBe(inkOf(panel));
  await expect(inkOf(stage)).not.toBe(inkOf(panel));
};

export const HeroStaysDarkInLight: Story = {
  globals: { theme: "light" },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: heroStaysDark,
};

export const HeroStaysDarkInSepia: Story = {
  globals: { theme: "sepia" },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: heroStaysDark,
};

export const RibbonUsesTheBooksAccentInBlack: Story = {
  globals: { theme: "black" },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".bp-ribbon-cloth")).not.toBeNull(),
    );
    const cloth = canvasElement.querySelector(".bp-ribbon-cloth") as Element;
    // The book's own colour, not the Black theme's near-white accent.
    await expect(getComputedStyle(cloth).fill).toContain("28.4");
    await expect(
      canvasElement
        .querySelector<HTMLElement>(".bp-root")
        ?.style.getPropertyValue("--accent"),
    ).toBe(BOOK.accent);
  },
};

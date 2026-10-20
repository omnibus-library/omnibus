import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQuery } from "@tanstack/react-query";
import { delay, HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { type BookUuid, statsQuery, toBookDetail } from "../../api";
import {
  type AttributedReview,
  type Review,
  ReviewPatch,
} from "../../api/generated/schemas";
import { nowSecs } from "../../format";
import {
  bookDetailHandlers,
  failing,
  hanging,
  readStatusHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import { aWireStatsSummary } from "../../testing/statsHandlers";
import {
  aWireBook,
  aWireOtherReview,
  aWireReadStatus,
  aWireReview,
} from "../../testing/wire";
import { shelvesQuery } from "./queries";
import { ReviewsStop } from "./ReviewsStop";
// The page brings the stop's styles; the clamp behind Read more needs them.
import "./BookDetail.css";

const SPOILER_HTML =
  '<p>The captain <span class="spoiler" role="button" tabindex="0" aria-expanded="false" aria-label="Reveal spoiler"><span class="spoiler-text" aria-hidden="true">was the signal</span></span> all along.</p>';

const LONG_HTML = Array.from(
  { length: 6 },
  (_, i) =>
    `<p>Paragraph ${i + 1}: the station creaks, the crew argues, and the answer from the dark keeps arriving a little earlier each night.</p>`,
).join("");

const GRACE = aWireOtherReview({
  user_id: 7,
  username: "grace",
  stars: 4.5,
  body_md: "Quietly devastating. The last chapter earns every page before it.",
  body_html:
    "<p>Quietly devastating. The last chapter earns <em>every</em> page before it.</p>",
  created_at: 1_760_400_000,
});

const LINUS = aWireOtherReview({
  user_id: 8,
  username: "linus",
  stars: 3,
  body_md: "The captain ||was the signal|| all along.",
  body_html: SPOILER_HTML,
  spoiler: true,
  created_at: 1_760_300_000,
});

const TOVE = aWireOtherReview({
  user_id: 9,
  username: "tove",
  stars: null,
  body_md: "long",
  body_html: LONG_HTML,
  created_at: 1_760_200_000,
});

const MARGARET = aWireOtherReview({
  user_id: 10,
  username: "margaret",
  stars: 5,
});
const ALAN = aWireOtherReview({ user_id: 11, username: "alan", stars: 2.5 });

const MINE: Review = aWireReview({
  stars: 4,
  rated_at: nowSecs() - 2 * 3600,
  body_md: "Better on the second read.",
  body_html: "<p>Better on the <strong>second</strong> read.</p>",
  notes_md: "Lend to Sam once he finishes the first one.",
  notes_html: "<p>Lend to Sam once he finishes the first one.</p>",
});

const writes: (ReviewPatch | "delete")[] = [];

const meta = {
  title: "Pages/BookDetail/ReviewsStop",
  component: ReviewsStop,
  args: { book: toBookDetail(aWireBook()) },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...bookDetailHandlers(aWireBook()));
    msw.use(...reviewHandlers({}, writes));
  },
} satisfies Meta<typeof ReviewsStop>;

export default meta;
type Story = StoryObj<typeof meta>;

const withReviews = (
  mine: Review | null,
  others: AttributedReview[] = [],
): Story["beforeEach"] =>
  function use({ msw }) {
    msw.use(...reviewHandlers({ mine, others }, writes));
  };

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/reviews/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("reviews-kicker")).toHaveTextContent(
      "Counting reviews",
    );
    await expect(canvas.getByText("Gathering the reviews")).toBeInTheDocument();
    await expect(canvas.queryByTestId("review-mine")).not.toBeInTheDocument();
  },
};

export const UnreadableReviewsOfferRetry: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get("/api/reviews/:uuid", () =>
        reads++ === 0
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json({ mine: null, others: [], summary: null }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the reviews",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await expect(await canvas.findByTestId("review-mine")).toBeInTheDocument();
  },
};

export const NobodyHasReviewedIt: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("review-mine");
    await expect(canvas.getByTestId("reviews-kicker")).toHaveTextContent(
      "No reviews yet",
    );
    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(canvas.getByTestId("review-write")).toHaveTextContent(
      "Write a review",
    );
    await expect(canvas.queryByTestId("review-delete")).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("review-summary"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByTestId("reviews-others-empty")).toHaveTextContent(
      "No other reader has rated or reviewed it yet.",
    );
  },
};

export const EveryoneHasHadTheirSay: Story = {
  beforeEach: withReviews(MINE, [GRACE, LINUS, TOVE, MARGARET, ALAN]),
  play: async ({ canvas }) => {
    const mine = await canvas.findByTestId("review-mine");
    await expect(canvas.getByTestId("reviews-kicker")).toHaveTextContent(
      "6 readers · 4 with a review",
    );
    await expect(within(mine).getByTestId("rating-meta")).toHaveTextContent(
      "rated 2 hours ago · 4 of 5",
    );
    await expect(
      within(mine).getByTestId("review-mine-text"),
    ).toHaveTextContent("Better on the second read.");
    await expect(within(mine).getByTestId("review-notes")).toHaveTextContent(
      "only you can see these",
    );
    await expect(within(mine).getByTestId("review-write")).toHaveTextContent(
      "Edit review",
    );

    const summary = canvas.getByTestId("review-summary");
    await expect(
      within(summary).getByTestId("review-average"),
    ).toHaveTextContent("3.8");
    await expect(summary).toHaveTextContent("5 readers rated it");
    await expect(
      within(summary).getByTestId("review-spread"),
    ).toHaveAccessibleName(
      "1 reader gave 2.5 stars, 1 gave 3 stars, 1 gave 4 stars, 1 gave 4.5 stars, 1 gave 5 stars",
    );

    const written = within(canvas.getByTestId("reviews-others")).getAllByTestId(
      "review",
    );
    await expect(written).toHaveLength(3);
    await expect(written[0]).toHaveTextContent("grace");
    await expect(
      within(written[0] as HTMLElement).getByRole("img", {
        name: "4.5 out of 5 stars",
      }),
    ).toBeInTheDocument();

    const row = canvas.getByRole("list", { name: "Rated without a review" });
    const items = within(row).getAllByRole("listitem");
    await expect(items).toHaveLength(2);
    await expect(items[0]).toHaveTextContent("margaret");
    await expect(
      within(items[0] as HTMLElement).getByRole("img", {
        name: "5 out of 5 stars",
      }),
    ).toBeInTheDocument();
  },
};

export const EveryoneHasHadTheirSayInLight: Story = {
  ...EveryoneHasHadTheirSay,
  globals: { theme: "light" },
};

export const ASpoilerStaysFoldedUntilShown: Story = {
  beforeEach: withReviews(null, [LINUS]),
  play: async ({ canvas, userEvent }) => {
    const review = await canvas.findByTestId("review");
    // The stars are never a spoiler.
    await expect(
      within(review).getByRole("img", { name: "3 out of 5 stars" }),
    ).toBeInTheDocument();
    await expect(
      within(review).getByTestId("review-spoiler-cover"),
    ).toHaveTextContent("Contains spoilers");
    await expect(
      within(review).queryByTestId("review-text"),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(review).getByRole("button", { name: "Show review" }),
    );

    await expect(within(review).getByTestId("review-text")).toHaveTextContent(
      "all along",
    );
  },
};

export const ASpoilerOpensForAReaderWhoFinished: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...reviewHandlers({ others: [LINUS] }, writes),
      ...readStatusHandlers(aWireReadStatus({ status: "finished" })),
    );
  },
  play: async ({ canvas }) => {
    const review = await canvas.findByTestId("review");
    await waitFor(() =>
      expect(within(review).getByTestId("review-text")).toHaveTextContent(
        "all along",
      ),
    );
    await expect(
      within(review).queryByTestId("review-spoiler-cover"),
    ).not.toBeInTheDocument();
  },
};

export const ALongReviewFoldsBehindReadMore: Story = {
  beforeEach: withReviews(null, [TOVE]),
  play: async ({ canvas, userEvent }) => {
    const review = await canvas.findByTestId("review");
    const more = await within(review).findByRole("button", {
      name: "Read more",
    });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    // Rated nothing, so the byline carries no stars.
    await expect(within(review).queryByRole("img")).not.toBeInTheDocument();

    await userEvent.click(more);

    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(more).toHaveTextContent("Show less");
  },
};

export const AShortReviewHasNoReadMore: Story = {
  beforeEach: withReviews(null, [GRACE]),
  play: async ({ canvas }) => {
    const review = await canvas.findByTestId("review");
    await expect(within(review).getByTestId("review-text")).toBeVisible();
    await expect(
      within(review).queryByRole("button", { name: "Read more" }),
    ).not.toBeInTheDocument();
  },
};

let shelfReads = 0;
let statsReads = 0;

// Stand in for the More stop and the stats page, which a stars change must refresh.
function Observers({ uuid }: { uuid: BookUuid }) {
  useQuery(shelvesQuery(uuid));
  useQuery(statsQuery("month", null));
  return null;
}

export const ATapSavesTheStarsAndRefreshesWhatSumsThem: Story = {
  render: (args) => (
    <>
      <Observers uuid={args.book.uuid} />
      <ReviewsStop {...args} />
    </>
  ),
  beforeEach({ msw }) {
    shelfReads = 0;
    statsReads = 0;
    msw.use(
      ...reviewHandlers({ others: [MARGARET] }, writes),
      http.get("/api/shelves", () => {
        shelfReads++;
      }),
      http.get("/api/stats", () => {
        statsReads++;
        return HttpResponse.json(aWireStatsSummary());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByTestId("rating-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(
      canvas.queryByTestId("review-summary"),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Rate 3.5 stars" }),
    );

    await waitFor(() => expect(writes).toEqual([{ stars: 3.5 }]));
    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
      "rated just now · 3.5 of 5",
    );
    // Two readers have now rated it, so the reread brings the summary.
    await expect(await canvas.findByTestId("review-average")).toHaveTextContent(
      "4.2",
    );
    await waitFor(() => expect(shelfReads).toBe(2));
    await waitFor(() => expect(statsReads).toBe(2));
  },
};

export const TappingTheCurrentValueClearsOnlyTheStars: Story = {
  beforeEach: withReviews(MINE),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear your 4-star rating" }),
    );

    await waitFor(() => expect(writes).toEqual([{ stars: null }]));
    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(canvas.getByTestId("review-mine-text")).toHaveTextContent(
      "Better on the second read.",
    );
    await expect(canvas.getByTestId("review-notes")).toBeInTheDocument();
  },
};

export const ARefusedTapPutsTheStarsBack: Story = {
  beforeEach({ msw }) {
    msw.use(
      // Ahead of the kept reviews' own PATCH, so it answers first.
      failing("patch", "/api/reviews/:uuid", 500),
      ...reviewHandlers({ mine: aWireReview({ stars: 2 }) }, writes),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 5 stars" }),
    );

    await expect(
      await canvas.findByText("Couldn't save — try again"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Clear your 2-star rating" }),
    ).toBeInTheDocument();
  },
};

export const TheNewestTapWinsWhenAnOlderOneLandsLate: Story = {
  beforeEach({ msw }) {
    let calls = 0;
    let stored: Review | null = null;
    msw.use(
      http.get("/api/reviews/:uuid", () =>
        HttpResponse.json({ mine: stored, others: [], summary: null }),
      ),
      http.patch("/api/reviews/:uuid", async ({ request }) => {
        const patch = ReviewPatch.parse(await request.json());
        // Only the first write is slow; the server stores whichever arrives last.
        if (calls++ === 0) await delay(400);
        stored = aWireReview({ stars: patch.stars, rated_at: nowSecs() });
        return HttpResponse.json(stored);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 3 stars" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Rate 5 stars" }));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent("5 of 5");
  },
};

export const WritingAReviewSavesOnSave: Story = {
  beforeEach: withReviews(aWireReview({ stars: 4 })),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("review-write"));
    const composer = await canvas.findByTestId("review-composer");
    await userEvent.type(
      within(composer).getByRole("textbox", { name: "Review text" }),
      "Worth it.",
    );
    await userEvent.type(
      within(composer).getByRole("textbox", { name: "Private notes" }),
      "Buy the hardback.",
    );
    // Nothing is sent while typing.
    await expect(writes).toEqual([]);

    await userEvent.click(within(composer).getByTestId("review-composer-save"));

    await waitFor(() =>
      expect(writes).toEqual([
        { body_md: "Worth it.", notes_md: "Buy the hardback." },
      ]),
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("review-composer")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("review-mine-text")).toHaveTextContent(
      "Worth it.",
    );
    await expect(canvas.getByTestId("review-notes")).toHaveTextContent(
      "Buy the hardback.",
    );
    // The stars were left alone.
    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent("4 of 5");
  },
};

export const ARefusedSaveKeepsTheComposerOpen: Story = {
  beforeEach({ msw }) {
    msw.use(failing("patch", "/api/reviews/:uuid", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("review-write"));
    const composer = await canvas.findByTestId("review-composer");
    await userEvent.type(
      within(composer).getByRole("textbox", { name: "Review text" }),
      "Don't lose me.",
    );
    await userEvent.click(within(composer).getByTestId("review-composer-save"));

    await waitFor(async () =>
      expect(await within(composer).findByRole("alert")).toHaveTextContent(
        "failed with 500",
      ),
    );
    await expect(
      within(composer).getByRole("textbox", { name: "Review text" }),
    ).toHaveTextContent("Don't lose me.");
    // The card went back to what the server holds.
    await expect(
      canvas.queryByTestId("review-mine-text"),
    ).not.toBeInTheDocument();
  },
};

export const TheSpoilerBoxSavesAtOnce: Story = {
  beforeEach: withReviews(MINE),
  play: async ({ canvas, userEvent }) => {
    const box = await canvas.findByRole("checkbox", {
      name: "Contains spoilers",
    });
    await expect(box).not.toBeChecked();

    await userEvent.click(box);

    await expect(box).toBeChecked();
    await waitFor(() => expect(writes).toEqual([{ spoiler: true }]));
  },
};

export const NoSpoilerBoxWithoutText: Story = {
  beforeEach: withReviews(aWireReview({ stars: 3 })),
  play: async ({ canvas }) => {
    await canvas.findByTestId("review-delete");
    await expect(
      canvas.queryByRole("checkbox", { name: "Contains spoilers" }),
    ).not.toBeInTheDocument();
  },
};

export const DeleteAsksThenRemovesEverything: Story = {
  beforeEach: withReviews(MINE),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("review-delete"));
    const dialog = await canvas.findByTestId("review-delete-modal");
    await expect(dialog).toHaveTextContent(
      "Your stars, your review and your private notes are removed for good.",
    );

    await userEvent.click(
      within(dialog).getByTestId("review-delete-modal-confirm"),
    );

    await waitFor(() => expect(writes).toEqual(["delete"]));
    await waitFor(() =>
      expect(
        canvas.queryByTestId("review-delete-modal"),
      ).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(canvas.queryByTestId("review-notes")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("review-write")).toHaveTextContent(
      "Write a review",
    );
  },
};

export const ARefusedDeleteKeepsTheReview: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("delete", "/api/reviews/:uuid", 500),
      ...reviewHandlers({ mine: MINE }, writes),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("review-delete"));
    const dialog = await canvas.findByTestId("review-delete-modal");
    await userEvent.click(
      within(dialog).getByTestId("review-delete-modal-confirm"),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(canvas.getByTestId("review-mine-text")).toHaveTextContent(
      "Better on the second read.",
    );
  },
};

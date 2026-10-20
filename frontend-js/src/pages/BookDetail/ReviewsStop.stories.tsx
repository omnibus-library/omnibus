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
  deferred,
  failing,
  hanging,
  readStatusHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import { aWireStatsSummary } from "../../testing/statsHandlers";
import {
  aWireBook,
  aWireBookReviews,
  aWireOtherReview,
  aWireReadStatus,
  aWireReview,
} from "../../testing/wire";
import { shelvesQuery } from "./queries";
import { ReviewsStop } from "./ReviewsStop";
// The page brings the stop's styles.
import "./BookDetail.css";

const SPOILER_HTML =
  '<p>The captain <span class="spoiler" role="button" tabindex="0" aria-expanded="false" aria-label="Reveal spoiler"><span class="spoiler-text" aria-hidden="true">was the signal</span></span> all along.</p>';

const PARAGRAPHS = Array.from(
  { length: 6 },
  (_, i) =>
    `Paragraph ${i + 1}: the station creaks, the crew argues, and the answer from the dark keeps arriving a little earlier each night.`,
);
const LONG_MD = PARAGRAPHS.join("\n\n");
const LONG_HTML = PARAGRAPHS.map((p) => `<p>${p}</p>`).join("");

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
  body_md: LONG_MD,
  body_html: LONG_HTML,
  created_at: 1_760_200_000,
});

const MARGARET = aWireOtherReview({
  user_id: 10,
  username: "margaret",
  stars: 5,
});
const ALAN = aWireOtherReview({ user_id: 11, username: "alan", stars: 2.5 });
const MARGARET_AT_4 = { ...MARGARET, stars: 4 };

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

/** The width each of your five stars is filled to, as drawn. */
const fills = (canvasElement: HTMLElement) =>
  [
    ...canvasElement.querySelectorAll<HTMLElement>(
      '[data-testid="review-stars"] .bd-star-fg',
    ),
  ].map((fg) => fg.style.width);

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/reviews/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("reviews-kicker")).toHaveTextContent(
      "Counting reviews",
    );
    await expect(canvas.getByTestId("reviews-loading")).toHaveTextContent(
      "Gathering the reviews",
    );
    await expect(canvas.queryByTestId("my-review")).not.toBeInTheDocument();
  },
};

export const UnreadableReviewsSaySo: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/reviews/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("reviews-error")).toHaveTextContent(
      "The reviews didn’t load — try reopening the book.",
    );
    await expect(canvas.queryByTestId("my-review")).not.toBeInTheDocument();
  },
};

export const NobodyHasReviewedIt: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("my-review");
    await expect(canvas.getByTestId("reviews-kicker")).toHaveTextContent(
      "No reviews yet",
    );
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(canvas.getByTestId("review-write")).toHaveAccessibleName(
      "Write review",
    );
    // Nothing to delete yet, so no trash can.
    await expect(canvas.queryByTestId("review-delete")).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("review-summary"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByTestId("other-reviews-empty")).toHaveTextContent(
      "No one else has rated or reviewed this book yet.",
    );
  },
};

export const EveryoneHasHadTheirSay: Story = {
  beforeEach: withReviews(MINE, [GRACE, LINUS, TOVE, MARGARET, ALAN]),
  play: async ({ canvas }) => {
    const mine = await canvas.findByRole("region", { name: "Your review" });
    await expect(canvas.getByTestId("reviews-kicker")).toHaveTextContent(
      "4 reviews · 5 ratings",
    );
    await expect(
      within(mine).getByTestId("review-stars-meta"),
    ).toHaveTextContent("rated 2 hours ago · 4 of 5");
    await expect(within(mine).getByTestId("my-review-text")).toHaveTextContent(
      "Better on the second read.",
    );
    await expect(within(mine).getByTestId("my-review-notes")).toHaveTextContent(
      "Private notes · only you can see these",
    );
    await expect(within(mine).getByTestId("review-write")).toHaveAccessibleName(
      "Edit review",
    );

    const summary = canvas.getByTestId("review-summary");
    await expect(
      within(summary).getByTestId("review-summary-average"),
    ).toHaveTextContent("3.8");
    await expect(
      within(summary).getByTestId("review-summary-count"),
    ).toHaveTextContent("5 readers in the household");
    await expect(
      within(summary).getByTestId("review-spread"),
    ).toHaveAccessibleName(
      "Ratings by stars: 1 reader at 2.5, 1 reader at 3, 1 reader at 4, 1 reader at 4.5, 1 reader at 5.",
    );

    const cards = within(canvas.getByTestId("other-reviews")).getAllByTestId(
      "review-card",
    );
    await expect(cards).toHaveLength(3);
    // Only your own card carries edit controls.
    for (const card of cards) {
      await expect(
        within(card).queryByRole("button", {
          name: /^(Edit review|Write review|Delete review)$/,
        }),
      ).not.toBeInTheDocument();
    }
    await expect(cards[0]).toHaveTextContent("grace");
    await expect(
      within(cards[0] as HTMLElement).getByRole("img", {
        name: "4.5 out of 5 stars",
      }),
    ).toBeInTheDocument();

    const row = canvas.getByRole("list", { name: "Ratings without a review" });
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

export const NoSummaryUntilTheServerSendsOne: Story = {
  beforeEach({ msw }) {
    // Two raters, but the threshold is the server's: no summary sent, none drawn.
    msw.use(
      http.get("/api/reviews/:uuid", () =>
        HttpResponse.json(
          aWireBookReviews({
            mine: aWireReview({ stars: 5 }),
            others: [MARGARET_AT_4],
            summary: null,
          }),
        ),
      ),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("review-stars-only");
    await expect(canvas.getByTestId("reviews-kicker")).toHaveTextContent(
      "0 reviews · 2 ratings",
    );
    await expect(
      canvas.queryByTestId("review-summary"),
    ).not.toBeInTheDocument();
  },
};

export const ASpoilerStaysVeiledUntilShown: Story = {
  beforeEach: withReviews(null, [LINUS]),
  play: async ({ canvas, userEvent }) => {
    const card = await canvas.findByTestId("review-card");
    // The stars are never a spoiler.
    await expect(
      within(card).getByRole("img", { name: "3 out of 5 stars" }),
    ).toBeInTheDocument();
    await expect(card).toHaveTextContent("spoilers");
    await expect(
      within(card).getByTestId("review-spoiler-veil"),
    ).toHaveTextContent("This review gives away the story.");
    await expect(
      within(card).queryByTestId("review-text"),
    ).not.toBeInTheDocument();

    await userEvent.click(within(card).getByTestId("review-spoiler-reveal"));

    await expect(within(card).getByTestId("review-text")).toHaveTextContent(
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
    const card = await canvas.findByTestId("review-card");
    await waitFor(() =>
      expect(within(card).getByTestId("review-text")).toHaveTextContent(
        "all along",
      ),
    );
    await expect(
      within(card).queryByTestId("review-spoiler-veil"),
    ).not.toBeInTheDocument();
  },
};

export const ALongReviewOpensClippedBehindReadMore: Story = {
  beforeEach: withReviews(null, [TOVE]),
  play: async ({ canvas, userEvent }) => {
    const card = await canvas.findByTestId("review-card");
    await expect(within(card).getByTestId("review-text")).toHaveClass(
      "is-clamped",
    );
    // Rated nothing, so the byline carries no stars.
    await expect(within(card).queryByRole("img")).not.toBeInTheDocument();

    await userEvent.click(within(card).getByTestId("review-read-more"));

    await expect(within(card).getByTestId("review-text")).not.toHaveClass(
      "is-clamped",
    );
    await expect(
      within(card).queryByTestId("review-read-more"),
    ).not.toBeInTheDocument();
  },
};

export const AShortReviewHasNoReadMore: Story = {
  beforeEach: withReviews(null, [GRACE]),
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("review-card");
    await expect(within(card).getByTestId("review-text")).not.toHaveClass(
      "is-clamped",
    );
    await expect(
      within(card).queryByTestId("review-read-more"),
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
    await expect(
      await canvas.findByTestId("review-stars-meta"),
    ).toHaveTextContent("Not rated yet");
    await expect(
      canvas.queryByTestId("review-summary"),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Rate 3.5 stars" }),
    );

    await waitFor(() => expect(writes).toEqual([{ stars: 3.5 }]));
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "rated just now · 3.5 of 5",
    );
    // Two readers have now rated it, so the re-read brings the summary.
    await expect(
      await canvas.findByTestId("review-summary-average"),
    ).toHaveTextContent("4.3");
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
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(canvas.getByTestId("my-review-text")).toHaveTextContent(
      "Better on the second read.",
    );
    await expect(canvas.getByTestId("my-review-notes")).toBeInTheDocument();
  },
};

export const ARefusedTapPutsTheStarsBack: Story = {
  beforeEach({ msw }) {
    msw.use(
      // Ahead of the kept reviews' own PATCH, so it answers first, and late enough to see the guess.
      http.patch("/api/reviews/:uuid", async () => {
        await delay(400);
        return new HttpResponse("failed with 500", { status: 500 });
      }),
      ...reviewHandlers({ mine: aWireReview({ stars: 2 }) }, writes),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 5 stars" }),
    );

    // Drawn at once, before the server has answered.
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "rated just now · 5 of 5",
    );
    await waitFor(() =>
      expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
        "Couldn’t save your rating — try again",
      ),
    );
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

    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "5 of 5",
    );
  },
};

export const ATapIsDrawnBeforeTheServerAnswers: Story = {
  beforeEach({ msw }) {
    msw.use(
      hanging("/api/reviews/:uuid", "patch"),
      ...reviewHandlers({ mine: aWireReview({ stars: 2 }) }, writes),
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 5 stars" }),
    );

    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "rated just now · 5 of 5",
    );
    await expect(
      canvas.getByRole("button", { name: "Clear your 5-star rating" }),
    ).toBeInTheDocument();
    await expect(fills(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "100%",
      "100%",
    ]);
  },
};

export const StarsFillToTheRatingAndPreviewTheHover: Story = {
  beforeEach: withReviews(aWireReview({ stars: 4.5 })),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByRole("group", { name: "Your rating" });
    await expect(fills(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "100%",
      "50%",
    ]);

    await userEvent.hover(
      canvas.getByRole("button", { name: "Rate 3.5 stars" }),
    );
    await expect(fills(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "50%",
      "0%",
    ]);

    // The current value's own half clears it; the pointer stays on it.
    const clear = canvas.getByRole("button", {
      name: "Clear your 4.5-star rating",
    });
    await userEvent.hover(clear);
    await userEvent.click(clear);

    // The fill shows the answer, not the pointer still resting on 4.5.
    await expect(fills(canvasElement)).toEqual(["0%", "0%", "0%", "0%", "0%"]);
    await waitFor(() => expect(writes).toEqual([{ stars: null }]));
  },
};

export const TheLastWriteToSettleRefetchesWhenTheNewestFailed: Story = {
  render: (args) => (
    <>
      <Observers uuid={args.book.uuid} />
      <ReviewsStop {...args} />
    </>
  ),
  beforeEach({ msw }) {
    let stored: Review | null = null;
    let calls = 0;
    shelfReads = 0;
    statsReads = 0;
    msw.use(
      http.get("/api/reviews/:uuid", () =>
        HttpResponse.json(aWireBookReviews({ mine: stored })),
      ),
      http.patch("/api/reviews/:uuid", async ({ request }) => {
        const patch = ReviewPatch.parse(await request.json());
        // The slow first write is stored when it lands, with text no guess of
        // the client's holds; the second is refused.
        if (calls++ > 0)
          return new HttpResponse("failed with 500", { status: 500 });
        await delay(400);
        stored = aWireReview({
          stars: patch.stars,
          rated_at: nowSecs(),
          body_md: "From the server",
          body_html: "<p>From the server</p>",
        });
        return HttpResponse.json(stored);
      }),
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
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 3 stars" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Rate 5 stars" }));

    // Only the re-read after the refusal can bring the stored text.
    await waitFor(() =>
      expect(canvas.getByTestId("my-review-text")).toHaveTextContent(
        "From the server",
      ),
    );
    await expect(
      canvas.getByRole("button", { name: "Clear your 3-star rating" }),
    ).toBeInTheDocument();
    // The stars the server took still moved what sums them.
    await waitFor(() => expect(shelfReads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(statsReads).toBeGreaterThanOrEqual(2));
  },
};

// Released by a story once the write queued behind the held tap has been sent.
const heldTap = { release: () => {} };

export const ARefusedTapIsToldEvenWhenASaveFollowsIt: Story = {
  beforeEach({ msw }) {
    const held = deferred();
    heldTap.release = held.release;
    let stored: Review = aWireReview({ stars: 2 });
    msw.use(
      http.get("/api/reviews/:uuid", () =>
        HttpResponse.json(aWireBookReviews({ mine: stored })),
      ),
      http.patch("/api/reviews/:uuid", async ({ request }) => {
        const patch = ReviewPatch.parse(await request.json());
        if (patch.stars !== undefined) {
          await held.promise;
          return new HttpResponse("failed with 500", { status: 500 });
        }
        const body = patch.body_md ?? null;
        stored = {
          ...stored,
          body_md: body,
          body_html: body && `<p>${body}</p>`,
        };
        return HttpResponse.json(stored);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 5 stars" }),
    );
    await userEvent.click(canvas.getByTestId("review-write"));
    const composer = await canvas.findByTestId("review-composer");
    await userEvent.type(
      within(composer).getByRole("textbox", { name: "Review text" }),
      "Worth it.",
    );
    await userEvent.click(within(composer).getByTestId("review-save"));
    // The tap is refused only now, behind the Save in the queue.
    heldTap.release();

    await waitFor(() =>
      expect(canvas.queryByTestId("review-composer")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("my-review-text")).toHaveTextContent(
      "Worth it.",
    );
    await waitFor(() =>
      expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
        "Couldn’t save your rating — try again",
      ),
    );
    await expect(
      canvas.getByRole("button", { name: "Clear your 2-star rating" }),
    ).toBeInTheDocument();
  },
};

export const ADeleteAfterARefusedTapLeavesNoError: Story = {
  beforeEach({ msw }) {
    const held = deferred();
    heldTap.release = held.release;
    let stored: Review | null = MINE;
    msw.use(
      http.get("/api/reviews/:uuid", () =>
        HttpResponse.json(aWireBookReviews({ mine: stored })),
      ),
      http.patch("/api/reviews/:uuid", async () => {
        await held.promise;
        return new HttpResponse("failed with 500", { status: 500 });
      }),
      http.delete("/api/reviews/:uuid", () => {
        stored = null;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 5 stars" }),
    );
    await userEvent.click(canvas.getByTestId("review-delete"));
    const dialog = await canvas.findByTestId("review-delete-modal");
    await userEvent.click(within(dialog).getByTestId("review-delete-confirm"));
    // The tap is refused only now, ahead of the delete in the queue.
    heldTap.release();

    await waitFor(() =>
      expect(
        canvas.queryByTestId("review-delete-modal"),
      ).not.toBeInTheDocument(),
    );
    // The review is gone, and so is the tap's refusal: the empty card has nothing to retry.
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(canvas.queryByTestId("review-delete")).not.toBeInTheDocument();
  },
};

export const AFailedReReadSaysTheFiguresAreOld: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get("/api/reviews/:uuid", () =>
        reads++ === 0
          ? HttpResponse.json(aWireBookReviews({ others: [MARGARET, ALAN] }))
          : new HttpResponse("failed with 500", { status: 500 }),
      ),
      http.patch("/api/reviews/:uuid", () =>
        HttpResponse.json(aWireReview({ stars: 4, rated_at: nowSecs() })),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 4 stars" }),
    );

    await expect(
      await canvas.findByTestId("reviews-refresh-failed"),
    ).toHaveTextContent(
      "Couldn’t refresh the other readers’ ratings — reopen the book to see them.",
    );
    // Your saved stars and the figures from before stay on screen.
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "4 of 5",
    );
    await expect(canvas.getByTestId("review-stars-only")).toBeInTheDocument();
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

    await userEvent.click(within(composer).getByTestId("review-save"));

    await waitFor(() =>
      expect(writes).toEqual([
        { body_md: "Worth it.", notes_md: "Buy the hardback." },
      ]),
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("review-composer")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("my-review-text")).toHaveTextContent(
      "Worth it.",
    );
    await expect(canvas.getByTestId("my-review-notes")).toHaveTextContent(
      "Buy the hardback.",
    );
    // The stars were left alone.
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "4 of 5",
    );
  },
};

export const SavingWithNothingChangedJustCloses: Story = {
  beforeEach: withReviews(MINE),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("review-write"));
    const composer = await canvas.findByTestId("review-composer");

    await userEvent.click(within(composer).getByTestId("review-save"));

    await waitFor(() =>
      expect(canvas.queryByTestId("review-composer")).not.toBeInTheDocument(),
    );
    await expect(writes).toEqual([]);
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
    await userEvent.click(within(composer).getByTestId("review-save"));

    await waitFor(async () =>
      expect(await within(composer).findByRole("alert")).toHaveTextContent(
        "failed with 500",
      ),
    );
    await expect(
      within(composer).getByRole("textbox", { name: "Review text" }),
    ).toHaveTextContent("Don't lose me.");
    // Text is never drawn before the server has it.
    await expect(
      canvas.queryByTestId("my-review-text"),
    ).not.toBeInTheDocument();
  },
};

export const TheCardsToolsAreAPencilAndATrashCan: Story = {
  beforeEach: withReviews(aWireReview({ stars: 3 })),
  play: async ({ canvas, userEvent }) => {
    const mine = await canvas.findByRole("region", { name: "Your review" });
    // Stars alone are no writing yet, so the pencil still offers to write.
    const pencil = within(mine).getByRole("button", { name: "Write review" });
    await expect(pencil).toHaveAttribute("title", "Write review");
    await expect(
      within(mine).getByRole("button", { name: "Delete review" }),
    ).toHaveAttribute("title", "Delete review");
    await expect(within(mine).queryByText("Write review")).toBeNull();

    await userEvent.click(pencil);

    await canvas.findByTestId("review-composer");
    // An open editor already is what the pencil would open.
    await expect(canvas.queryByTestId("review-write")).not.toBeInTheDocument();
  },
};

export const NotesAloneMakeThePencilEdit: Story = {
  beforeEach: withReviews(
    aWireReview({
      stars: null,
      rated_at: null,
      notes_md: "For me only.",
      notes_html: "<p>For me only.</p>",
    }),
  ),
  play: async ({ canvas }) => {
    const mine = await canvas.findByRole("region", { name: "Your review" });
    await expect(within(mine).getByTestId("review-write")).toHaveAccessibleName(
      "Edit review",
    );
    await expect(
      within(mine).getByTestId("review-stars-meta"),
    ).toHaveTextContent("Not rated yet");
    await expect(within(mine).getByTestId("my-review-notes")).toHaveTextContent(
      "For me only.",
    );
  },
};

export const ReadModeCarriesNoSpoilerControl: Story = {
  beforeEach: withReviews({ ...MINE, spoiler: true }),
  play: async ({ canvas }) => {
    const mine = await canvas.findByRole("region", { name: "Your review" });
    await expect(within(mine).getByTestId("my-review-text")).toBeVisible();
    await expect(
      within(mine).queryByRole("checkbox", { name: "Contains spoilers" }),
    ).not.toBeInTheDocument();
    await expect(mine).not.toHaveTextContent(/spoiler/i);
  },
};

export const TheSpoilerFlagSavesWithTheComposer: Story = {
  beforeEach: withReviews(MINE),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("review-write"));
    const composer = await canvas.findByTestId("review-composer");
    const box = within(composer).getByRole("checkbox", {
      name: "Contains spoilers",
    });
    await expect(box).not.toBeChecked();

    await userEvent.click(box);
    // Nothing is sent until Save.
    await expect(writes).toEqual([]);
    await userEvent.click(within(composer).getByTestId("review-save"));

    // The flag alone is a change worth saving, and travels without the text.
    await waitFor(() => expect(writes).toEqual([{ spoiler: true }]));
    await waitFor(() =>
      expect(canvas.queryByTestId("review-composer")).not.toBeInTheDocument(),
    );
  },
};

export const DeleteAsksThenRemovesEverything: Story = {
  beforeEach: withReviews(MINE),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("review-delete"));
    const dialog = await canvas.findByTestId("review-delete-modal");
    await expect(dialog).toHaveTextContent(
      "This removes your stars, your review and your private notes for good.",
    );

    await userEvent.click(within(dialog).getByTestId("review-delete-confirm"));

    await waitFor(() => expect(writes).toEqual(["delete"]));
    await waitFor(() =>
      expect(
        canvas.queryByTestId("review-delete-modal"),
      ).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("review-stars-meta")).toHaveTextContent(
      "Not rated yet",
    );
    await expect(
      canvas.queryByTestId("my-review-notes"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByTestId("review-write")).toHaveAccessibleName(
      "Write review",
    );
    await expect(canvas.queryByTestId("review-delete")).not.toBeInTheDocument();
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
    await userEvent.click(within(dialog).getByTestId("review-delete-confirm"));

    await expect(
      await within(dialog).findByTestId("review-delete-error"),
    ).toHaveTextContent("failed with 500");
    await expect(canvas.getByTestId("my-review-text")).toHaveTextContent(
      "Better on the second read.",
    );
  },
};

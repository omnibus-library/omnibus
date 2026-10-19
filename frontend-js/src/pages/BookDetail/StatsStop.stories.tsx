import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQuery } from "@tanstack/react-query";
import { delay, HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { type BookUuid, toBookDetail } from "../../api";
import {
  getGetBookInsightsMockHandler200,
  getGetOtherRatingsMockHandler200,
  getGetProgressMockHandler200,
} from "../../api/generated/omnibus.msw";
import { PostRatingBody, type RatingRecord } from "../../api/generated/schemas";
import {
  bookDetailHandlers,
  failing,
  hanging,
  physicalHandlers,
  ratingHandlers,
  sessionLogHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireFile,
  aWireInsights,
  aWireOtherRating,
  aWirePosition,
  aWireProgress,
  aWireRating,
  aWireSession,
  aWireWishlist,
} from "../../testing/wire";
import { shelvesQuery } from "./queries";
import { StatsStop } from "./StatsStop";

const nowSecs = () => Math.floor(Date.now() / 1000);

const meta = {
  title: "Pages/BookDetail/StatsStop",
  component: StatsStop,
  args: { book: toBookDetail(aWireBook()) },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook()));
  },
} satisfies Meta<typeof StatsStop>;

export default meta;
type Story = StoryObj<typeof meta>;

const fills = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll<HTMLElement>(".bd-star-fg")].map(
    (fg) => fg.style.width,
  );

export const LoadingInsights: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/books/:uuid/insights"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("At a glance stats")).toBeInTheDocument();
    await expect(canvas.getByText("Tallying your reading")).toBeInTheDocument();
    await expect(canvas.queryByText("No stats yet.")).not.toBeInTheDocument();
  },
};

export const NoSessions: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No stats yet.")).toBeInTheDocument();
    await expect(
      canvas.getByText(/Open the book and the record starts itself/),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
      "Not rated yet",
    );
  },
};

const SITTINGS = [
  aWireSession({ started_at: 1_700_000_000, seconds: 2700 }),
  aWireSession({
    started_at: 1_699_900_000,
    seconds: 7500,
    format: "listening",
  }),
];

export const WithSessions: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      sessionLogHandler(SITTINGS),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Your sessions")).toBeInTheDocument();
    await expect(await canvas.findAllByTestId("session-log-row")).toHaveLength(
      2,
    );
    await expect(canvas.queryByText("No stats yet.")).not.toBeInTheDocument();
  },
};

const cells = (stats: HTMLElement) =>
  [...stats.querySelectorAll(".rx-stat")].map((cell) =>
    [...cell.children].map((part) => part.textContent),
  );

export const RecordShowsTheFourFigures: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(
        aWireInsights({
          started_at: nowSecs() - 3 * 86_400 - 60,
          longest_started_at: 1_760_004_000,
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const stats = await canvas.findByTestId("bdmq-stats");
    await expect(cells(stats)).toEqual([
      [
        "Started",
        expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2}$/),
        "3 days in",
      ],
      ["Time in book", "1h", "3 sessions"],
      ["Pickups", "3", "avg sit 16m"],
      ["Longest sit", "30m", "Oct 9"],
    ]);
  },
};

export const AudioOnlyBookCountsTimeListened: Story = {
  args: {
    book: toBookDetail(
      aWireBook({
        formats: ["M4B"],
        book_files: [aWireFile({ id: 21, format: "M4B" })],
      }),
    ),
  },
  beforeEach({ msw }) {
    msw.use(getGetBookInsightsMockHandler200(aWireInsights()));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Time listened")).toBeInTheDocument();
    await expect(canvas.getByTestId("bdmq-spark")).toHaveAccessibleName(
      /^Minutes listened per day/,
    );
  },
};

export const SparkLabelsItsDaysAndMarksTheActiveOnes: Story = {
  beforeEach({ msw }) {
    msw.use(getGetBookInsightsMockHandler200(aWireInsights()));
  },
  play: async ({ canvas }) => {
    const spark = await canvas.findByTestId("bdmq-spark");
    await expect(spark).toHaveAccessibleName(
      "Minutes read per day over the last 22 days: 60 minutes across 2 days, most on Aug 20 with 30 minutes.",
    );
    await expect(spark.querySelectorAll("i")).toHaveLength(22);
    await expect(spark.querySelectorAll("i.on")).toHaveLength(2);
    await expect(canvas.getByText("3 wk ago")).toBeInTheDocument();
  },
};

const readAt = (percent: number) =>
  getGetProgressMockHandler200(
    aWireProgress(aWirePosition({ progress_percent: percent })),
  );

export const PaceNoteExtrapolatesFromHowFarIn: Story = {
  beforeEach({ msw }) {
    msw.use(getGetBookInsightsMockHandler200(aWireInsights()), readAt(40));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("≈ 1h 30m to go at your pace · 40% in"),
    ).toBeInTheDocument();
  },
};

export const NoPaceNoteJustAfterStarting: Story = {
  beforeEach({ msw }) {
    msw.use(getGetBookInsightsMockHandler200(aWireInsights()), readAt(3));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bdmq-stats");
    await expect(
      canvas.queryByText(/to go at your pace/),
    ).not.toBeInTheDocument();
  },
};

export const FinishedBookSaysTheRecordIsComplete: Story = {
  beforeEach({ msw }) {
    msw.use(getGetBookInsightsMockHandler200(aWireInsights()), readAt(100));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("finished — the record is complete"),
    ).toBeInTheDocument();
  },
};

export const UnreadableRecordIsTheEmptyState: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/books/:uuid/insights", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No stats yet.")).toBeInTheDocument();
    await expect(canvas.queryByTestId("bdmq-stats")).not.toBeInTheDocument();
  },
};

export const SessionsFailing: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      failing("get", "/api/stats/sessions", 500),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load your session log",
    );
    // The record is still the record.
    await expect(canvas.getByTestId("bdmq-stats")).toBeInTheDocument();
    await expect(canvas.queryByText("No stats yet.")).not.toBeInTheDocument();
  },
};

export const Rated: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...ratingHandlers(
        aWireRating({ stars: 4.5, updated_at: nowSecs() - 3 * 3600 }),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
        "rated 3 hours ago · 4.5 of 5",
      ),
    );
    await expect(fills(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "100%",
      "50%",
    ]);
    await expect(
      canvas.getByRole("button", { name: "Clear your 4.5-star rating" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Rate 5 stars" }),
    ).toBeInTheDocument();
  },
};

const writes: (number | null)[] = [];

let shelfReads = 0;

// Stands in for the More stop, which holds the shelves a rating save must refresh.
function ShelfObserver({ uuid }: { uuid: BookUuid }) {
  useQuery(shelvesQuery(uuid));
  return null;
}

export const RatingSavesAndClears: Story = {
  render: (args) => (
    <>
      <ShelfObserver uuid={args.book.uuid} />
      <StatsStop {...args} />
    </>
  ),
  beforeEach({ msw }) {
    writes.length = 0;
    shelfReads = 0;
    msw.use(
      http.get("/api/shelves", () => {
        shelfReads++;
      }),
      ...ratingHandlers(null, writes),
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.hover(
      await canvas.findByRole("button", { name: "Rate 3.5 stars" }),
    );
    await expect(fills(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "50%",
      "0%",
    ]);

    await userEvent.click(
      canvas.getByRole("button", { name: "Rate 3.5 stars" }),
    );

    await waitFor(() => expect(writes).toEqual([3.5]));
    await waitFor(() =>
      expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
        "rated just now · 3.5 of 5",
      ),
    );
    // A smart shelf may now hold the book: the shelf facts are read again.
    await waitFor(() => expect(shelfReads).toBe(2));

    await userEvent.click(
      canvas.getByRole("button", { name: "Clear your 3.5-star rating" }),
    );

    await waitFor(() => expect(writes).toEqual([3.5, null]));
    await waitFor(() =>
      expect(canvas.getByTestId("rating-meta")).toHaveTextContent(
        "Not rated yet",
      ),
    );
  },
};

export const TheNewestRatingWinsWhenAnOlderOneLandsLate: Story = {
  beforeEach({ msw }) {
    let stored: RatingRecord | null = null;
    let calls = 0;
    msw.use(
      http.get("/api/ratings/:uuid", () => HttpResponse.json(stored)),
      http.post("/api/ratings", async ({ request }) => {
        const body = PostRatingBody.parse(await request.json());
        const saved = { ...body, updated_at: nowSecs() };
        stored = saved;
        // Only the first answer is slow, so it lands after the second.
        if (calls++ === 0) await delay(400);
        return HttpResponse.json(saved);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rate 3 stars" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Rate 5 stars" }));

    await new Promise((resolve) => setTimeout(resolve, 800));

    await expect(canvas.getByTestId("rating-meta")).toHaveTextContent("5 of 5");
  },
};

export const RatingSaveFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/ratings",
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
      ...ratingHandlers(aWireRating({ stars: 2, updated_at: nowSecs() })),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("rating-meta")).toHaveTextContent("2 of 5"),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Rate 5 stars" }));

    await expect(
      await canvas.findByText("Couldn't save rating — try again"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Clear your 2-star rating" }),
    ).toBeInTheDocument();
  },
};

export const OtherReaders: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetOtherRatingsMockHandler200([
        aWireOtherRating({
          user_id: 7,
          username: "grace",
          stars: 3.5,
          updated_at: nowSecs() - 86_400,
        }),
        aWireOtherRating({
          user_id: 8,
          username: "linus",
          stars: 5,
          updated_at: nowSecs() - 60,
        }),
      ]),
    );
  },
  play: async ({ canvas }) => {
    const list = await canvas.findByRole("group", { name: "Other ratings" });
    const rows = within(list).getAllByTestId("other-rating-row");
    await expect(rows).toHaveLength(2);
    await expect(
      within(rows[0] as HTMLElement).getByTestId("other-rating-byline"),
    ).toHaveTextContent("grace rated 1 day ago");
    await expect(
      within(rows[0] as HTMLElement).getByRole("img", {
        name: "3.5 out of 5 stars",
      }),
    ).toBeInTheDocument();
  },
};

export const NoOtherReaders: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("No stats yet.");
    await expect(
      canvas.queryByRole("group", { name: "Other ratings" }),
    ).not.toBeInTheDocument();
  },
};

export const WishlistOnlyBookHasNothingToTally: Story = {
  args: { book: toBookDetail(aWireBook({ formats: [] })) },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({ wishlist: aWireWishlist() }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Stats")).toBeInTheDocument();
    await expect(
      canvas.getByText(/Add an ebook or an audiobook to start tracking/),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("bdmq-rating")).toBeInTheDocument();
  },
};

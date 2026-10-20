import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetBookInsightsMockHandler200,
  getGetProgressMockHandler200,
} from "../../api/generated/omnibus.msw";
import { nowSecs } from "../../format";
import {
  bookDetailHandlers,
  failing,
  hanging,
  physicalHandlers,
  sessionLogHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireFile,
  aWireInsights,
  aWirePosition,
  aWireProgress,
  aWireSession,
  aWireWishlist,
} from "../../testing/wire";
import { StatsStop } from "./StatsStop";

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
    // The rating moved to the Reviews stop.
    await expect(canvas.queryByTestId("review-stars")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("group", { name: "Your rating" }),
    ).not.toBeInTheDocument();
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
          // Local noon, so the day reads the same in every zone.
          longest_started_at: Math.floor(
            new Date(2025, 9, 9, 12).getTime() / 1000,
          ),
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

export const UnreadableRecordOffersRetryAndKeepsTheSessionLog: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get("/api/books/:uuid/insights", () =>
        reads++ === 0
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireInsights()),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load your reading record",
    );
    await expect(canvas.queryByText("No stats yet.")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("session-log")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await expect(await canvas.findByTestId("bdmq-stats")).toBeInTheDocument();
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
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetBookHouseholdMockHandler200,
  getGetBookInsightsMockHandler200,
  getGetProgressMockHandler200,
} from "../../api/generated/omnibus.msw";
import { nowSecs } from "../../format";
import {
  bookDetailHandlers,
  failing,
  hanging,
  physicalHandlers,
  readStatusHandlers,
  reviewHandlers,
  sessionLogHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireBookHouseholdReader,
  aWireFile,
  aWireInsights,
  aWireOtherReview,
  aWirePosition,
  aWireProgress,
  aWireReadStatus,
  aWireSession,
  aWireWishlist,
} from "../../testing/wire";
import { YourReading } from "./YourReading";

const meta = {
  title: "Pages/BookDetail/YourReading",
  component: YourReading,
  args: { book: toBookDetail(aWireBook({ page_count: 300 })) },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook({ page_count: 300 })));
  },
} satisfies Meta<typeof YourReading>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Local noon, so the day reads the same in every zone. */
const noon = (month: number, day: number, year = new Date().getFullYear()) =>
  Math.floor(new Date(year, month - 1, day, 12).getTime() / 1000);

const readAt = (percent: number) =>
  getGetProgressMockHandler200(
    aWireProgress(
      aWirePosition({
        progress_percent: percent,
        client_updated_at: nowSecs() - 3600,
      }),
    ),
  );

const reading = () =>
  readStatusHandlers(aWireReadStatus({ status: "reading" }));

/** Each row as its label and its value. */
const rowsOf = (list: HTMLElement) =>
  [...list.querySelectorAll("div")].map((row) => [
    row.querySelector("dt")?.textContent,
    row.querySelector("dd")?.textContent,
  ]);

export const LoadingInsights: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/books/:uuid/insights"));
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "Your reading" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Tallying your reading")).toBeInTheDocument();
    await expect(canvas.queryByText("Not started yet")).not.toBeInTheDocument();
  },
};

export const NoSessions: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Not started yet"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/No reading recorded yet/),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("bp-stats")).not.toBeInTheDocument();
    // The rating lives on the Reviews tab.
    await expect(
      canvas.queryByRole("group", { name: "Your rating" }),
    ).not.toBeInTheDocument();
  },
};

export const ListsTimePaceLastReadLongestTimeLeftAndRatings: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(
        aWireInsights({
          seconds_total: 3600,
          started_at: noon(10, 2),
          longest_seconds: 4800,
          longest_started_at: noon(10, 12),
        }),
      ),
      readAt(40),
      ...reading(),
      ...reviewHandlers({
        others: [
          aWireOtherReview({ user_id: 7, username: "grace", stars: 4.5 }),
          aWireOtherReview({ user_id: 8, username: "linus", stars: 3 }),
          aWireOtherReview({ user_id: 9, username: "tove", stars: null }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    const list = await canvas.findByTestId("bp-stats");
    await expect(canvas.getByText(/^Reading since /)).toBeInTheDocument();
    await waitFor(() =>
      expect(rowsOf(list)).toEqual([
        ["Time read", "1 h over 3 sessions"],
        ["Pace", "About 120 pages an hour"],
        [
          "Last read",
          expect.stringMatching(
            /^Today at \d\d:\d\d$|^Yesterday at \d\d:\d\d$/,
          ),
        ],
        ["Longest sitting", "1 h 20 m on October 12"],
        ["Time left", "About 1 h 30 m at your pace"],
        ["Household ratings", "grace 4.5, linus 3"],
      ]),
    );
  },
};

export const ShowSessionsRevealsTheSparkAndLog: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      sessionLogHandler([
        aWireSession({ started_at: 1_700_000_000, seconds: 2700 }),
        aWireSession({
          started_at: 1_699_900_000,
          seconds: 7500,
          format: "listening",
        }),
      ]),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const summary = await canvas.findByText("Show sessions");
    // Closed by default: nothing of the log is asked for or drawn.
    await expect(canvas.queryByTestId("session-log")).not.toBeInTheDocument();

    await userEvent.click(summary);

    await expect(await canvas.findByText("Hide sessions")).toBeInTheDocument();
    await expect(
      canvas.getByText(/^Minutes a day, last 14 days/),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("bp-spark")).toHaveAccessibleName(
      /^Minutes read per day over the last 14 days/,
    );
    const log = await canvas.findByRole("list", {
      name: "Sessions, newest first",
    });
    await expect(log.querySelectorAll("li")).toHaveLength(2);
  },
};

export const HouseholdBlockShowsOtherReadersActivity: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      getGetBookHouseholdMockHandler200([
        aWireBookHouseholdReader({
          name: "Maya",
          seconds: 9_960,
          sessions: 3,
          last_session_at: noon(10, 19),
        }),
      ]),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Household" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Maya")).toBeInTheDocument();
    await expect(
      canvas.getByText("Read 2 h 46 m over 3 sessions"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Last read October 19")).toBeInTheDocument();
  },
};

export const NoHouseholdBlockWhenNobodyElseOpenedIt: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Not started yet");
    await waitFor(() =>
      expect(
        canvas.queryByText("Gathering your household"),
      ).not.toBeInTheDocument(),
    );
    await expect(
      canvas.queryByRole("heading", { name: "Household" }),
    ).not.toBeInTheDocument();
  },
};

export const HouseholdLoadingShowsTheLoader: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/books/:uuid/household"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Gathering your household"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { name: "Household" }),
    ).not.toBeInTheDocument();
  },
};

let householdAsked = false;

export const HouseholdFailureLeavesTheBlockOut: Story = {
  beforeEach({ msw }) {
    householdAsked = false;
    msw.use(
      http.get("/api/books/:uuid/household", () => {
        householdAsked = true;
        return new HttpResponse("failed with 500", { status: 500 });
      }),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(householdAsked).toBe(true));
    await waitFor(() =>
      expect(
        canvas.queryByText("Gathering your household"),
      ).not.toBeInTheDocument(),
    );
    // Not a false "nobody": the block is simply not drawn.
    await expect(
      canvas.queryByRole("heading", { name: "Household" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByText("Not started yet")).toBeInTheDocument();
  },
};

export const RecordShowsTimeAndLongestSitting: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(
        aWireInsights({ longest_started_at: noon(10, 9) }),
      ),
    );
  },
  play: async ({ canvas }) => {
    const list = await canvas.findByTestId("bp-stats");
    await expect(rowsOf(list)).toEqual([
      ["Time read", "1 h over 3 sessions"],
      ["Longest sitting", "30 m on October 9"],
    ]);
  },
};

export const AudioOnlyBookCountsTimeListened: Story = {
  args: {
    book: toBookDetail(
      aWireBook({
        formats: ["M4B"],
        book_files: [aWireFile({ id: 21, format: "M4B" })],
        page_count: 300,
      }),
    ),
  },
  beforeEach({ msw }) {
    msw.use(getGetBookInsightsMockHandler200(aWireInsights()), readAt(40));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText("Time listened")).toBeInTheDocument();
    // Pages an hour means nothing for a recording.
    await expect(canvas.queryByText("Pace")).not.toBeInTheDocument();
    await expect(canvas.getByText(/^Listening since /)).toBeInTheDocument();

    await userEvent.click(canvas.getByText("Show sessions"));

    await expect(await canvas.findByTestId("bp-spark")).toHaveAccessibleName(
      /^Minutes listened per day/,
    );
  },
};

export const SparkLabelsItsDaysAndMarksTheActiveOnes: Story = {
  beforeEach({ msw }) {
    msw.use(getGetBookInsightsMockHandler200(aWireInsights()));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByText("Show sessions"));

    const spark = await canvas.findByTestId("bp-spark");
    await expect(spark).toHaveAccessibleName(
      "Minutes read per day over the last 14 days: 60 minutes across 2 days, most on Aug 20 with 30 minutes.",
    );
    await expect(spark.querySelectorAll("span")).toHaveLength(14);
    await expect(spark.querySelectorAll("span:not(.is-none)")).toHaveLength(2);
    await expect(canvas.getByText("Today")).toBeInTheDocument();
  },
};

export const PaceRowExtrapolatesFromHowFarIn: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      readAt(40),
      ...reading(),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("About 1 h 30 m at your pace"),
    ).toBeInTheDocument();
  },
};

export const NoPaceRowsJustAfterStarting: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      readAt(3),
      ...reading(),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-stats");
    await expect(canvas.queryByText("Pace")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Time left")).not.toBeInTheDocument();
  },
};

export const FinishedBookSaysWhenAndAfterHowLong: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(
        aWireInsights({ started_at: noon(10, 2) }),
      ),
      readAt(100),
      ...readStatusHandlers(
        aWireReadStatus({ status: "finished", finished_at: noon(10, 18) }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        /^Finished October 18, \d{4} at 12:00, after 17 days$/,
      ),
    ).toBeInTheDocument();
    // Done: nothing left to estimate.
    await expect(canvas.queryByText("Time left")).not.toBeInTheDocument();
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
    await expect(canvas.queryByText("Not started yet")).not.toBeInTheDocument();
    // The sessions are asked for separately, and still there to open.
    await userEvent.click(canvas.getByText("Show sessions"));
    await expect(await canvas.findByTestId("session-log")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await expect(await canvas.findByTestId("bp-stats")).toBeInTheDocument();
  },
};

export const SessionsFailing: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetBookInsightsMockHandler200(aWireInsights()),
      failing("get", "/api/stats/sessions", 500),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByText("Show sessions"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load your session log",
    );
    // The record is still the record.
    await expect(canvas.getByTestId("bp-stats")).toBeInTheDocument();
  },
};

export const WishlistOnlyBookHasNothingToTally: Story = {
  args: { book: toBookDetail(aWireBook({ formats: [] })) },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({ wishlist: aWireWishlist() }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/Add an ebook or an audiobook to start tracking/),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("Show sessions")).not.toBeInTheDocument();
  },
};

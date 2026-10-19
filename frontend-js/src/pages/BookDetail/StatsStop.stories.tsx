import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { getGetOtherRatingsMockHandler200 } from "../../api/generated/omnibus.msw";
import {
  bookDetailHandlers,
  failing,
  hanging,
  ratingHandlers,
  sessionLogHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireOtherRating,
  aWireRating,
  aWireSession,
} from "../../testing/wire";
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

export const LoadingSessions: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/stats/sessions"));
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

export const WithSessions: Story = {
  beforeEach({ msw }) {
    msw.use(
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
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Your sessions")).toBeInTheDocument();
    await expect(await canvas.findAllByTestId("session-log-row")).toHaveLength(
      2,
    );
    await expect(canvas.queryByText("No stats yet.")).not.toBeInTheDocument();
  },
};

export const SessionsFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/stats/sessions", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load your session log",
    );
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

export const RatingSavesAndClears: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...ratingHandlers(null, writes));
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

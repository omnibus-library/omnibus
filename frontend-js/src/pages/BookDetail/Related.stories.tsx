import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetAuthorByIdMockHandler200,
  getGetSeriesByIdMockHandler200,
  getGetSuggestionsMockHandler200,
} from "../../api/generated/omnibus.msw";
import { bookDetailHandlers, failing, hanging } from "../../testing/handlers";
import {
  aWireAuthor,
  aWireBook,
  aWireSeries,
  aWireSuggestion,
} from "../../testing/wire";
import { Related } from "./Related";
import "./BookDetail.css";
import "./BookPage.css";

const THIS = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";
const volume = (n: number) =>
  aWireBook({
    id: n,
    title: `Aurora Station, Vol. ${n}`,
    series_index: String(n),
    unique_identifier:
      n === 1 ? THIS : `00000000-0000-4000-8000-00000000000${n}`,
    cover_url: null,
  });

const SERIES = aWireSeries({ books: [volume(1), volume(2), volume(3)] });

function aBook(overrides: Parameters<typeof aWireBook>[0] = {}) {
  return toBookDetail(aWireBook({ series_id: 4, ...overrides }));
}

const meta = {
  title: "Pages/BookDetail/Related",
  component: Related,
  args: { book: aBook() },
  decorators: [
    (Story) => (
      <div className="bp-root">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(
      getGetSeriesByIdMockHandler200(SERIES),
      ...bookDetailHandlers(aWireBook()),
    );
  },
} satisfies Meta<typeof Related>;

export default meta;
type Story = StoryObj<typeof meta>;

const fan = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("bp-series-fan"));

export const SeriesFanInReadingOrder: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Aurora Station series" }),
    ).toBeInTheDocument();
    await canvas.findByTestId("bp-series-fan");
    const items = fan(canvas).getAllByRole("link");
    await expect(items.map((a) => a.getAttribute("href"))).toEqual([
      `/books/${THIS}`,
      "/books/00000000-0000-4000-8000-000000000002",
      "/books/00000000-0000-4000-8000-000000000003",
    ]);
    await expect(items[0]).toHaveAttribute("aria-current", "page");
    await expect(items[0]).toHaveTextContent("Book 1 · This book");
    await expect(items[1]).toHaveTextContent("Book 2 · Up next");
    await expect(items[2]).toHaveTextContent(/Book 3$/);
    await expect(
      canvas.getByText(
        "3 books in your library · Aurora Station, Vol. 2 is up next",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Series page" }),
    ).toHaveAttribute("href", "/series/4");
  },
};

export const SeriesLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/series/:id"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Gathering the series")).toBeInTheDocument();
    await expect(canvas.queryByText(/in your library/)).not.toBeInTheDocument();
  },
};

export const SeriesUnavailable: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/series/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("bp-series-unavailable"),
    ).toHaveTextContent("The series didn’t load — Series page");
  },
};

export const SeriesMissing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/series/:id", 404));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("bp-series-unavailable"),
    ).toBeInTheDocument();
  },
};

export const NoSeriesNoFan: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-related");
    await expect(
      canvas.queryByRole("heading", { name: /series$/ }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("bp-series-fan")).not.toBeInTheDocument();
  },
};

const other = (n: number) =>
  aWireBook({
    id: 10 + n,
    title: `Tidewater ${n}`,
    unique_identifier: `00000000-0000-4000-8000-00000000010${n}`,
    published: `20${10 + n}-05-01`,
    series: null,
    series_id: null,
  });
const THIS_BOOK = aWireBook();
const STANDALONE = { book: aBook({ series: null, series_id: null }) };

export const MoreByListsTheAuthorsOtherBooks: Story = {
  args: STANDALONE,
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200(
        aWireAuthor({
          book_count: 3,
          books: [THIS_BOOK, other(2), other(3)],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "More by Sora Inkwell" }),
    ).toBeInTheDocument();
    const tiles = await canvas.findAllByTestId("bp-more-by-tile");
    // This book is not among its author's others.
    await expect(tiles).toHaveLength(2);
    await expect(tiles[0]).toHaveAttribute(
      "href",
      `/books/${other(2).unique_identifier}`,
    );
    await expect(tiles[0]).toHaveTextContent("Tidewater 2");
    await expect(tiles[0]).toHaveTextContent("2012");
    await expect(
      canvas.getByRole("link", { name: "Author page" }),
    ).toHaveAttribute("href", "/authors/2");
  },
};

export const MoreByShowsAtMostFour: Story = {
  args: STANDALONE,
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200(
        aWireAuthor({
          book_count: 6,
          books: [THIS_BOOK, ...[2, 3, 4, 5, 6].map(other)],
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByTestId("bp-more-by-tile")).toHaveLength(
      4,
    );
  },
};

export const MoreByIsAbsentWhenTheAuthorHasNoOtherBook: Story = {
  args: STANDALONE,
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200(
        aWireAuthor({ book_count: 1, books: [THIS_BOOK] }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-related");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      canvas.queryByRole("heading", { name: /^More by/ }),
    ).not.toBeInTheDocument();
  },
};

export const MoreByNotCountingAWishlistOnlyBook: Story = {
  args: STANDALONE,
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200(
        aWireAuthor({ book_count: 1, books: [other(2)] }),
      ),
    );
  },
  play: async ({ canvas }) => {
    // The author page credits only the other book, so this one is not claimed.
    await expect(await canvas.findAllByTestId("bp-more-by-tile")).toHaveLength(
      1,
    );
  },
};

export const MoreByIsAbsentWhenTheAuthorIsNotFound: Story = {
  args: STANDALONE,
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/authors/:id", 404));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-related");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      canvas.queryByRole("heading", { name: /^More by/ }),
    ).not.toBeInTheDocument();
  },
};

export const MoreByIsAbsentWhenTheFetchFails: Story = {
  args: STANDALONE,
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/authors/:id", 500));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-related");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      canvas.queryByRole("heading", { name: /^More by/ }),
    ).not.toBeInTheDocument();
  },
};

export const MoreByLoadingNeverClaimsAnything: Story = {
  args: STANDALONE,
  beforeEach({ msw }) {
    msw.use(hanging("/api/authors/:id"));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-related");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      canvas.queryByRole("heading", { name: /^More by/ }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText(/in your library/)).not.toBeInTheDocument();
  },
};

export const MoreByWithoutAnAuthorIdHasNoLinks: Story = {
  args: {
    book: aBook({
      series: null,
      series_id: null,
      creators: [{ name: "Sora Inkwell", role: null, file_as: null }],
    }),
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bp-related");
    await expect(
      canvas.queryByRole("link", { name: "Author page" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { name: /^More by/ }),
    ).not.toBeInTheDocument();
  },
};

const READY = {
  status: "ready",
  items: [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    aWireSuggestion({
      hardcover_id: n,
      title: `Suggested ${n}`,
      hardcover_url: `https://hardcover.app/books/s${n}`,
      list_count: n,
      cover_url: n === 1 ? "/api/suggestions/x/1/cover" : null,
    }),
  ),
} as const;

export const SuggestionsRowLinksOutToHardcover: Story = {
  beforeEach({ msw }) {
    msw.use(getGetSuggestionsMockHandler200(READY));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        name: "Readers who finished Aurora Station, Vol. 1 also read",
      }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("From Hardcover")).toBeInTheDocument();
    // Every one is in the one row; there is no Show more.
    const cards = canvas.getAllByTestId("suggestion-card");
    await expect(cards).toHaveLength(8);
    await expect(cards[0]).toHaveAttribute(
      "href",
      "https://hardcover.app/books/s1",
    );
    await expect(cards[0]).toHaveAttribute("target", "_blank");
    await expect(cards[1]).toHaveTextContent("Suggested 2Susanna Clarke");
    await expect(
      canvas.queryByRole("button", { name: /Show \d+ more/ }),
    ).not.toBeInTheDocument();
  },
};

export const SuggestionsRowScrollsSidewaysAndSnaps: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetSuggestionsMockHandler200({
        status: "ready",
        items: [...Array(14).keys()].map((n) =>
          aWireSuggestion({
            hardcover_id: n,
            title: `Suggested ${n}`,
            hardcover_url: `https://hardcover.app/books/s${n}`,
            list_count: 1,
            cover_url: null,
          }),
        ),
      }),
    );
  },
  play: async ({ canvas }) => {
    const row = (await canvas.findAllByTestId("suggestion-card"))[0]?.closest(
      "ul",
    );
    if (!row) throw new Error("the suggestions are not in a row");
    await expect(getComputedStyle(row).overflowX).toBe("auto");
    await expect(getComputedStyle(row).scrollSnapType).toContain("x");
    await expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
  },
};

export const SuggestionsPendingThenReady: Story = {
  beforeEach({ msw }) {
    let asked = 0;
    msw.use(
      http.get("/api/ebooks/:uuid/suggestions", () =>
        HttpResponse.json(++asked < 2 ? { status: "pending" } : READY),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("suggestions-pending"),
    ).toHaveTextContent("Looking for read-alikes via Hardcover…");
    // Asked again after 2.5 seconds.
    await expect(
      await canvas.findAllByTestId("suggestion-card", {}, { timeout: 6000 }),
    ).toHaveLength(8);
    await expect(
      canvas.queryByTestId("suggestions-pending"),
    ).not.toBeInTheDocument();
  },
};

const settled = async (canvas: ReturnType<typeof within>) => {
  await canvas.findByTestId("bp-series-fan");
  await new Promise((resolve) => setTimeout(resolve, 200));
};

export const SuggestionsRenderNothingWhenThereAreNone: Story = {
  beforeEach({ msw }) {
    msw.use(getGetSuggestionsMockHandler200({ status: "ready", items: [] }));
  },
  play: async ({ canvas }) => {
    await settled(canvas);
    await expect(
      canvas.queryByTestId("suggestions-strip"),
    ).not.toBeInTheDocument();
  },
};

export const SuggestionsRenderNothingWithoutAKey: Story = {
  beforeEach({ msw }) {
    msw.use(getGetSuggestionsMockHandler200({ status: "not_configured" }));
  },
  play: async ({ canvas }) => {
    await settled(canvas);
    await expect(
      canvas.queryByTestId("suggestions-strip"),
    ).not.toBeInTheDocument();
  },
};

export const SuggestionsRenderNothingWhenTheFetchFails: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks/:uuid/suggestions", 500));
  },
  play: async ({ canvas }) => {
    await settled(canvas);
    await expect(
      canvas.queryByTestId("suggestions-strip"),
    ).not.toBeInTheDocument();
  },
};

export const EveryCoverIsOneSize: Story = {
  beforeEach({ msw }) {
    msw.use(
      getGetSuggestionsMockHandler200(READY),
      getGetAuthorByIdMockHandler200(
        aWireAuthor({
          book_count: 3,
          books: [THIS_BOOK, other(2), other(3)],
        }),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findAllByTestId("bp-more-by-tile");
    await canvas.findAllByTestId("suggestion-card");
    const widths = (selector: string) =>
      // Layout width, not the drawn box: the fan's covers are rotated.
      [...canvasElement.querySelectorAll<HTMLElement>(selector)].map(
        (cover) => cover.offsetWidth,
      );
    for (const selector of [
      ".bp-fan .cover-wrap",
      '[data-testid="bp-more-by"] .cover-wrap',
      '[data-testid="suggestion-card"] .cover-wrap',
    ]) {
      const sizes = widths(selector);
      await expect(sizes.length).toBeGreaterThan(0);
      await expect(new Set(sizes.map(Math.round))).toEqual(new Set([150]));
    }
  },
};

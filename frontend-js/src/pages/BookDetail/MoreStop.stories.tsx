import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  getGetAuthorByIdMockHandler200,
  getGetSeriesByIdMockHandler200,
  getGetSuggestionsMockHandler200,
} from "../../api/generated/omnibus.msw";
import {
  bookDetailHandlers,
  failing,
  hanging,
  physicalHandlers,
  shelvesHandlers,
} from "../../testing/handlers";
import {
  aWireAuthor,
  aWireBook,
  aWireSeries,
  aWireShelf,
  aWireSuggestion,
  aWireWishlist,
  WIRE_ADA,
} from "../../testing/wire";
import { MoreStop } from "./MoreStop";

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
const writes: string[] = [];

function aBook(overrides: Parameters<typeof aWireBook>[0] = {}) {
  return toBookDetail(aWireBook({ series_id: 4, ...overrides }));
}

const meta = {
  title: "Pages/BookDetail/MoreStop",
  component: MoreStop,
  args: { book: aBook() },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(
      getGetSeriesByIdMockHandler200(SERIES),
      ...shelvesHandlers([], {}, writes),
      ...bookDetailHandlers(aWireBook()),
    );
  },
} satisfies Meta<typeof MoreStop>;

export default meta;
type Story = StoryObj<typeof meta>;

const NOT_ADMIN = { ...WIRE_ADA, is_admin: false };
const MINE = aWireShelf({ id: 7, name: "Space operas", book_count: 2 });
const SMART = aWireShelf({
  id: 3,
  kind: "smart",
  name: "Unread sci-fi",
  book_count: 5,
});
const GRACES = aWireShelf({
  id: 9,
  name: "Grace's picks",
  owner_user_id: 9,
  owner_username: "grace",
});
const WISHLIST = aWireShelf({
  id: 11,
  kind: "wishlist",
  name: "Ada's Wishlist",
  book_count: 1,
});

export const SeriesShelfInReadingOrder: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Aurora Station · 3 in your library"),
    ).toBeInTheDocument();
    const items = within(canvas.getByTestId("bdmq-series-shelf")).getAllByRole(
      "link",
    );
    await expect(items.map((a) => a.getAttribute("href"))).toEqual([
      `/books/${THIS}`,
      "/books/00000000-0000-4000-8000-000000000002",
      "/books/00000000-0000-4000-8000-000000000003",
    ]);
    await expect(items[0]).toHaveClass("current");
    await expect(items[0]).toHaveTextContent("Book 1 · this book");
    await expect(items[1]).toHaveTextContent("Up next");
    await expect(items[2]).not.toHaveTextContent("Up next");
    await expect(
      canvas.getByRole("link", { name: "series page →" }),
    ).toHaveAttribute("href", "/series/4");
  },
};

export const SeriesLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/series/:id"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Gathering the series")).toBeInTheDocument();
  },
};

export const SeriesUnavailable: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/series/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("bdmq-series-unavailable"),
    ).toHaveTextContent("the shelf didn’t load — series page →");
  },
};

export const StandaloneOnNoShelf: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Standalone · on your shelves"),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByText("Not on a shelf yet."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("bdmq-add-to-shelf")).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("bdmq-series-shelf"),
    ).not.toBeInTheDocument();
  },
};

export const SeriesBookOnNoShelfGetsOnlyTheButton: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("On your shelves")).toBeInTheDocument();
    await expect(
      await canvas.findByTestId("bdmq-add-to-shelf"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("Not on a shelf yet."),
    ).not.toBeInTheDocument();
  },
};

export const ShelvesLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Checking your shelves")).toBeInTheDocument();
    await expect(
      canvas.queryByText("Not on a shelf yet."),
    ).not.toBeInTheDocument();
  },
};

export const ShelvesFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/shelves/containing/:uuid/smart", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("bdmq-shelves-unavailable"),
    ).toHaveTextContent(
      "your shelves didn’t load — see them on the library page →",
    );
    await expect(
      canvas.queryByText("Not on a shelf yet."),
    ).not.toBeInTheDocument();
  },
};

export const HeldShelvesAsTilesEndingInAddToShelf: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...physicalHandlers({ wishlist: aWireWishlist() }),
      ...shelvesHandlers(
        [SMART, WISHLIST, MINE, GRACES],
        { manual: [7], smart: [3] },
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    const tiles = within(
      await canvas.findByTestId("bdmq-shelves"),
    ).getAllByRole("link");
    // Hand-picked, then smart, then the wishlist; the shelf of someone else's isn't held.
    await expect(tiles.map((t) => t.getAttribute("href"))).toEqual([
      "/shelves/7",
      "/shelves/3",
      "/shelves/11",
    ]);
    await expect(tiles[0]).toHaveAccessibleName("Space operas");
    await expect(
      canvas.getByTestId("bdmq-shelves").lastElementChild,
    ).toHaveTextContent("Add to shelf");
  },
};

export const WishlistTileOnlyWhileTheBookIsWished: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE, WISHLIST], { manual: [7] }, writes));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bdmq-shelves");
    await expect(canvas.queryByTestId("bdmq-shelf-11")).not.toBeInTheDocument();
  },
};

export const PickerAddsTheBookAndPatchesTheTile: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], {}, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bdmq-add-to-shelf"));
    const dialog = canvas.getByRole("dialog", { name: "Add to shelf" });
    const tile = await within(dialog).findByRole("checkbox", {
      name: "Space operas",
    });
    await expect(tile).not.toBeChecked();

    await userEvent.click(tile);

    await waitFor(() => expect(writes).toEqual(["add:7"]));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("checkbox", { name: "Space operas" }),
      ).toBeChecked(),
    );
    await userEvent.click(within(dialog).getByTestId("shelf-picker-close"));
    // The block now shows the shelf with the book counted in.
    const held = await canvas.findByTestId("bdmq-shelf-7");
    await expect(held).toHaveTextContent("3 books");
  },
};

let releaseStaleRead = () => {};

function RefetchShelves() {
  const client = useQueryClient();
  return (
    <button
      type="button"
      onClick={() =>
        void client.invalidateQueries({ queryKey: ["book", THIS, "shelves"] })
      }
    >
      Refetch shelves
    </button>
  );
}

export const AToggleSurvivesAReadStartedBeforeIt: Story = {
  render: (args) => (
    <>
      <RefetchShelves />
      <MoreStop {...args} />
    </>
  ),
  beforeEach({ msw }) {
    const held = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    let reads = 0;
    msw.use(
      // The second read asks before the toggle and answers after it.
      http.get("/api/shelves/containing/:uuid", async () => {
        if (reads++ === 1) {
          await held;
          return HttpResponse.json([]);
        }
        return HttpResponse.json(writes.includes("add:7") ? [7] : []);
      }),
      ...shelvesHandlers([MINE], {}, writes),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bdmq-add-to-shelf"));
    await userEvent.click(
      canvas.getByRole("button", { name: "Refetch shelves" }),
    );
    const dialog = canvas.getByRole("dialog", { name: "Add to shelf" });
    await userEvent.click(
      await within(dialog).findByRole("checkbox", { name: "Space operas" }),
    );
    await waitFor(() => expect(writes).toEqual(["add:7"]));

    releaseStaleRead();
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(
      within(dialog).getByRole("checkbox", { name: "Space operas" }),
    ).toBeChecked();
  },
};

export const PickerRemovesTheBook: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], { manual: [7] }, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("bdmq-shelf-7");
    await userEvent.click(canvas.getByTestId("bdmq-add-to-shelf"));
    const dialog = canvas.getByRole("dialog");

    await userEvent.click(
      await within(dialog).findByRole("checkbox", { name: "Space operas" }),
    );

    await waitFor(() => expect(writes).toEqual(["remove:7"]));
    await userEvent.click(within(dialog).getByTestId("shelf-picker-close"));
    await waitFor(() =>
      expect(canvas.queryByTestId("bdmq-shelf-7")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("bdmq-add-to-shelf")).toBeInTheDocument();
  },
};

export const PickerFailureLeavesTheTileAsItWas: Story = {
  beforeEach({ msw }) {
    msw.use(...shelvesHandlers([MINE], {}, writes, 7));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bdmq-add-to-shelf"));
    const dialog = canvas.getByRole("dialog");
    await userEvent.click(
      await within(dialog).findByRole("checkbox", { name: "Space operas" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t update Space operas: failed with 500",
    );
    await expect(
      within(dialog).getByRole("checkbox", { name: "Space operas" }),
    ).not.toBeChecked();
    await expect(writes).toEqual([]);
  },
};

export const PickerListsOnlyShelvesTheReaderMayChange: Story = {
  parameters: { user: NOT_ADMIN },
  beforeEach({ msw }) {
    msw.use(
      ...shelvesHandlers(
        [MINE, GRACES, SMART, WISHLIST],
        { smart: [3] },
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("bdmq-add-to-shelf"));
    const dialog = canvas.getByRole("dialog");

    await within(dialog).findByRole("checkbox", { name: "Space operas" });
    await expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    // The smart shelf matching the book is shown, but not as something to tick.
    await expect(
      within(dialog).getByTestId("shelf-picker-auto-3"),
    ).toHaveTextContent("Unread sci-fi");
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

export const SameHandSpreadsTheAuthorsOtherBooks: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
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
      await canvas.findByText("More by Sora Inkwell"),
    ).toBeInTheDocument();
    const tiles = await canvas.findAllByTestId("from-same-hand-tile");
    // This book is the lead's count, not a tile.
    await expect(tiles).toHaveLength(2);
    await expect(tiles[0]).toHaveAttribute(
      "href",
      `/books/${other(2).unique_identifier}`,
    );
    await expect(tiles[0]).toHaveTextContent("Tidewater 2");
    await expect(tiles[0]).toHaveTextContent("2012");
    const lead = canvas.getByText("3 books in your library");
    await expect(lead).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Sora Inkwell" }),
    ).toHaveAttribute("href", "/authors/2");
    await expect(
      canvas.getByRole("link", { name: "Author page →" }),
    ).toHaveAttribute("href", "/authors/2");
    await expect(canvas.queryByText(/more →/)).not.toBeInTheDocument();
  },
};

export const SameHandShowsFourAndCountsTheRest: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
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
    await expect(
      await canvas.findAllByTestId("from-same-hand-tile"),
    ).toHaveLength(4);
    await expect(
      canvas.getByRole("link", { name: "+1 more →" }),
    ).toHaveAttribute("href", "/authors/2");
  },
};

export const SameHandAloneSaysItIsTheOnlyBook: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200(
        aWireAuthor({ book_count: 1, books: [THIS_BOOK] }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("from-same-hand-empty"),
    ).toHaveTextContent(
      "This is the only book by Inkwell in your library so far.",
    );
    await expect(
      canvas.queryByTestId("from-same-hand"),
    ).not.toBeInTheDocument();
  },
};

export const SameHandNotCountingAWishlistOnlyBook: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
  beforeEach({ msw }) {
    msw.use(
      getGetAuthorByIdMockHandler200(
        aWireAuthor({ book_count: 1, books: [other(2)] }),
      ),
    );
  },
  play: async ({ canvas }) => {
    // The author page credits only the other book, so this one is not claimed.
    await expect(
      await canvas.findAllByTestId("from-same-hand-tile"),
    ).toHaveLength(1);
  },
};

export const SameHandAuthorNotFoundFallsBackToThisBook: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/authors/:id", 404));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("from-same-hand-empty"),
    ).toHaveTextContent("only book by Inkwell");
  },
};

export const SameHandFailureFallsBackToThisBook: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/authors/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("from-same-hand-empty"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText(/Looking for more by/),
    ).not.toBeInTheDocument();
  },
};

export const SameHandLoadingNeverClaimsACount: Story = {
  args: { book: aBook({ series: null, series_id: null }) },
  beforeEach({ msw }) {
    msw.use(hanging("/api/authors/:id"));
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Looking for more by Inkwell"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("from-same-hand-empty"),
    ).not.toBeInTheDocument();
  },
};

export const SameHandWithoutAnAuthorIdHasNoLinks: Story = {
  args: {
    book: aBook({
      series: null,
      series_id: null,
      creators: [{ name: "Sora Inkwell", role: null, file_as: null }],
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("from-same-hand-empty"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: /Author page/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText("Sora Inkwell", { selector: ".author-lead-name" }),
    ).toBeInTheDocument();
  },
};

const READY = {
  status: "ready",
  items: [1, 2, 3, 4, 5, 6, 7].map((n) =>
    aWireSuggestion({
      hardcover_id: n,
      title: `Suggested ${n}`,
      hardcover_url: `https://hardcover.app/books/s${n}`,
      list_count: n,
      cover_url: n === 1 ? "/api/suggestions/x/1/cover" : null,
    }),
  ),
} as const;

export const SuggestionsStripLinksOutToHardcover: Story = {
  beforeEach({ msw }) {
    msw.use(getGetSuggestionsMockHandler200(READY));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText("If you liked Aurora Station, Vol. 1…"),
    ).toBeInTheDocument();
    const cards = canvas.getAllByTestId("suggestion-card");
    await expect(cards).toHaveLength(5);
    await expect(cards[0]).toHaveAttribute(
      "href",
      "https://hardcover.app/books/s1",
    );
    await expect(cards[0]).toHaveAttribute("target", "_blank");
    await expect(cards[0]).toHaveTextContent("on 1 list");
    await expect(cards[1]).toHaveTextContent("on 2 lists");
    await expect(cards[1]).toHaveTextContent("Suggested 2Susanna Clarke");

    await userEvent.click(canvas.getByTestId("suggestions-show-more"));

    await expect(canvas.getAllByTestId("suggestion-card")).toHaveLength(7);
    await expect(
      canvas.queryByTestId("suggestions-show-more"),
    ).not.toBeInTheDocument();
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
    ).toHaveLength(5);
    await expect(
      canvas.queryByTestId("suggestions-pending"),
    ).not.toBeInTheDocument();
  },
};

export const SuggestionsRenderNothingWhenThereAreNone: Story = {
  beforeEach({ msw }) {
    msw.use(getGetSuggestionsMockHandler200({ status: "ready", items: [] }));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bdmq-add-to-shelf");
    await expect(
      canvas.queryByTestId("suggestions-strip"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Suggested for you"),
    ).not.toBeInTheDocument();
  },
};

export const SuggestionsRenderNothingWithoutAKey: Story = {
  beforeEach({ msw }) {
    msw.use(getGetSuggestionsMockHandler200({ status: "not_configured" }));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("bdmq-add-to-shelf");
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
    await canvas.findByTestId("bdmq-add-to-shelf");
    await expect(
      canvas.queryByTestId("suggestions-strip"),
    ).not.toBeInTheDocument();
  },
};

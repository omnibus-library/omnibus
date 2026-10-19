import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { delay, HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import type { BulkOverridesRequest } from "../../api/generated/schemas";
import {
  addShelfBooksHandler,
  bulkOverridesHandler,
  failing,
  filterOptionHandlers,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
  recentProgressHandler,
  shelfPageHandler,
  shelvesHandler,
  stackSeriesHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireLibrary,
  aWireResumePoint,
  aWireShelf,
  aWireStack,
  uuidOf,
  WIRE_ADA,
} from "../../testing/wire";
import { Library } from "./Library";

const PREFS_KEY = `omnibus.view_prefs::${LIBRARY_PATH}`;

const meta = {
  title: "Pages/Library",
  component: Library,
  // The three keys the page reads, so no story inherits another's prefs.
  beforeEach({ msw }) {
    msw.use(shelvesHandler([]), recentProgressHandler([]));
    for (const key of [
      PREFS_KEY,
      "omnibus.view_prefs.last_library",
      "omnibus.landing_shelf",
    ]) {
      localStorage.removeItem(key);
    }
  },
} satisfies Meta<typeof Library>;

export default meta;
type Story = StoryObj<typeof meta>;

const requests: URLSearchParams[] = [];
const bodies: unknown[] = [];

const TABLE_PREFS = '{"view_mode":"table","sort_key":"title","sort_dir":"asc"}';

// Opens straight into the table, as a reader who left it there would.
function seedTable() {
  localStorage.setItem("omnibus.view_prefs.last_library", LIBRARY_PATH);
  localStorage.setItem(PREFS_KEY, TABLE_PREFS);
}

let release: () => void = () => {};
let holding = false;
let refusing = false;

// Hands the page's query client to a play, to refetch after a handler changes its answer.
let pageClient: QueryClient;
function GrabClient() {
  pageClient = useQueryClient();
  return null;
}
const withClient: Decorator = (Story) => (
  <>
    <GrabClient />
    <Story />
  </>
);

// A promise a handler awaits, so a story holds a request until it calls `release`.
function holdRequests() {
  return new Promise<void>((resolve) => {
    release = resolve;
  });
}

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(40), 30));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Your Library" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findAllByRole("link", { name: /^Open details for/ }),
    ).toHaveLength(30);

    await userEvent.click(canvas.getByRole("button", { name: "Load more" }));

    await expect(
      await canvas.findByRole("link", {
        name: "Open details for Aurora Station, Vol. 40",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  },
};

export const LoadMoreFails: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    msw.use(
      // Page 2 and after fail; page 1 falls through to the fixture handler.
      http.get("/api/ebooks", ({ request }) => {
        const { searchParams } = new URL(request.url);
        if (!searchParams.has("cursor")) return;
        requests.push(searchParams);
        return new HttpResponse("failed with 500", { status: 500 });
      }),
      libraryHandler(aWireLibrary(6), 3),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load more",
    );
    await expect(tiles(canvas)).toHaveLength(3);
    await expect(
      canvas.queryByText(/Couldn't load the library/),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Load more" }),
    ).toBeEnabled();

    // The row is still on screen, yet the failed page is not asked for again on its own.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(requests.length).toBeLessThanOrEqual(2);
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler([]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No ebooks found."),
    ).toBeInTheDocument();
  },
};

export const RefetchFails: Story = {
  decorators: [withClient],
  beforeEach({ msw }) {
    refusing = false;
    msw.use(
      http.get("/api/ebooks", () =>
        refusing
          ? new HttpResponse("failed with 500", { status: 500 })
          : undefined,
      ),
      libraryHandler([]),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No ebooks found."),
    ).toBeInTheDocument();

    refusing = true;
    await pageClient.invalidateQueries({ queryKey: ["books"] });

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't refresh the library",
    );
    await expect(canvas.getByText("No ebooks found.")).toBeInTheDocument();
  },
};

export const NoLibraryPath: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler([], 3, { path: null }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "Configure your ebook library path in Administration › Sources.",
      ),
    ).toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the library",
    );
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Taking the books off the shelf",
    );
  },
};

export const SortSaves: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    msw.use(libraryHandler(aWireLibrary(5), 3, { requests }));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findAllByRole("link", { name: /^Open details for/ });

    await userEvent.selectOptions(
      canvas.getByRole("combobox", { name: "Sort by" }),
      "Author",
    );

    await waitFor(() => {
      const last = requests.at(-1);
      expect(last?.get("sort")).toBe("author");
      expect(last?.get("dir")).toBe("asc");
    });
    await expect(localStorage.getItem(PREFS_KEY)).toContain(
      '"sort_key":"author"',
    );

    await userEvent.click(
      canvas.getByRole("button", { name: "Sort direction: ascending" }),
    );

    await waitFor(() => expect(requests.at(-1)?.get("dir")).toBe("desc"));
    await expect(
      canvas.getByRole("button", { name: "Sort direction: descending" }),
    ).toBeInTheDocument();
    await expect(localStorage.getItem(PREFS_KEY)).toContain(
      '"sort_dir":"desc"',
    );
  },
};

export const SortRestores: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    localStorage.setItem("omnibus.view_prefs.last_library", LIBRARY_PATH);
    localStorage.setItem(
      PREFS_KEY,
      '{"view_mode":"grid","sort_key":"author","sort_dir":"desc"}',
    );
    msw.use(libraryHandler(aWireLibrary(5), 3, { requests }));
  },
  play: async ({ canvas }) => {
    await canvas.findAllByRole("link", { name: /^Open details for/ });

    await expect(requests[0]?.get("sort")).toBe("author");
    await expect(requests[0]?.get("dir")).toBe("desc");
    await expect(
      canvas.getByRole("combobox", { name: "Sort by" }),
    ).toHaveDisplayValue("Author");
  },
};

const TABLE_BOOKS = aWireLibrary(150).map((book, i) =>
  i === 0
    ? {
        ...book,
        subjects: ["space opera"],
        genres: ["Science Fiction"],
        language: "en",
        has_physical: true,
      }
    : book,
);

export const TableView: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    msw.use(libraryHandler(TABLE_BOOKS, 30, { requests }));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findAllByRole("link", { name: /^Open details for/ });

    await userEvent.click(canvas.getByRole("button", { name: "Table" }));

    const row = (await canvas.findAllByRole("row"))[1];
    await expect(row).toHaveTextContent("Aurora Station #1");
    await expect(row).toHaveTextContent("space opera");
    await expect(row).toHaveTextContent("Science Fiction");
    await expect(row).toHaveTextContent("Mar 1st, 2021");
    await expect(row).toHaveTextContent("CBZ");
    await expect(row).toHaveTextContent("PHYS");
    await expect(
      canvas.queryByRole("combobox", { name: "Sort by" }),
    ).not.toBeInTheDocument();
    await expect(localStorage.getItem(PREFS_KEY)).toContain(
      '"view_mode":"table"',
    );

    const title = canvas.getByRole("columnheader", { name: /^Title/ });
    await expect(title).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(title).getByRole("button"));
    await waitFor(() => expect(requests.at(-1)?.get("dir")).toBe("desc"));
    await expect(
      await canvas.findByRole("columnheader", { name: /^Title/ }),
    ).toHaveAttribute("aria-sort", "descending");

    await userEvent.click(
      await canvas.findByRole("button", { name: "Last Updated" }),
    );
    await waitFor(() => {
      expect(requests.at(-1)?.get("sort")).toBe("last_updated");
      expect(requests.at(-1)?.get("dir")).toBe("desc");
    });
    await expect(
      await canvas.findByRole("columnheader", { name: /^Last Updated/ }),
    ).toHaveAttribute("aria-sort", "descending");
    await expect(
      canvas.getByRole("columnheader", { name: /^Title/ }),
    ).toHaveAttribute("aria-sort", "none");
  },
};

export const TableRestores: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(libraryHandler(TABLE_BOOKS, 30));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("table")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Table" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};

export const TablePaging: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(libraryHandler(TABLE_BOOKS, 60));
  },
  play: async ({ canvas, userEvent }) => {
    const rows = () =>
      canvas.queryAllByRole("link", { name: /^Open details for/ });
    await waitFor(() => expect(rows()).toHaveLength(60));

    await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(rows()).toHaveLength(120));

    // The observer takes the last page as the button nears the viewport.
    canvas.getByRole("button", { name: "Load more" }).scrollIntoView();
    await waitFor(() => expect(rows()).toHaveLength(150));
    await expect(
      canvas.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  },
};

export const TableLoading: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(hanging("/api/ebooks"));
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Taking the books off the shelf",
    );
    await expect(canvasElement.querySelector(".ld-rows")).not.toBeNull();
  },
};

const ADA_FILTER =
  '[{"field":"author","mode":"include","values":["Ada Lovelace"]}]';

// Half the books are Ada Lovelace's, the other half Sora Inkwell's.
const BY_TWO_AUTHORS = aWireLibrary(6).map((book, i) => ({
  ...book,
  creators: [
    {
      name: i % 2 ? "Ada Lovelace" : "Sora Inkwell",
      role: null,
      file_as: null,
      id: 2 + (i % 2),
    },
  ],
}));

const AUTHOR_OPTIONS = filterOptionHandlers({
  authors: [
    { id: 2, name: "Sora Inkwell", book_count: 3 },
    { id: 3, name: "Ada Lovelace", book_count: 3 },
    { id: 4, name: "Nobody", book_count: 0 },
  ],
});

// Opens the browse list under an author filter saved by an earlier visit.
function seedAdaFilter() {
  localStorage.setItem("omnibus.view_prefs.last_library", LIBRARY_PATH);
  localStorage.setItem(
    PREFS_KEY,
    `{"view_mode":"grid","sort_key":"title","sort_dir":"asc","filters":{"clauses":${ADA_FILTER}}}`,
  );
}

const tiles = (canvas: ReturnType<typeof within>) =>
  canvas.queryAllByRole("link", { name: /^Open details for/ });

export const Filtered: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    msw.use(
      libraryHandler(BY_TWO_AUTHORS, 10, { requests }),
      ...AUTHOR_OPTIONS,
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    await expect(canvas.queryByText(/^\d+ books?$/)).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Author" }));
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: "Ada Lovelace" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Apply (1)" }));

    await waitFor(() => expect(tiles(canvas)).toHaveLength(3));
    await expect(requests.at(-1)?.get("filter")).toBe(ADA_FILTER);
    await expect(await canvas.findByText("3 books")).toBeInTheDocument();
    await expect(localStorage.getItem(PREFS_KEY)).toContain('"Ada Lovelace"');
  },
};

export const FilteredToNothing: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(BY_TWO_AUTHORS, 10), ...AUTHOR_OPTIONS);
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    await userEvent.click(canvas.getByRole("button", { name: "Author" }));
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: "Nobody" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Apply (1)" }));

    await expect(
      await canvas.findByText("No books match these filters."),
    ).toBeInTheDocument();
    await expect(await canvas.findByText("0 books")).toBeInTheDocument();
    await expect(
      canvas.queryByText("No ebooks found."),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Clear filters" }),
    );

    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    await expect(localStorage.getItem(PREFS_KEY)).toContain(
      '"filters":{"clauses":[]}',
    );
  },
};

export const FilteredCounting: Story = {
  beforeEach({ msw }) {
    seedAdaFilter();
    const gate = holdRequests();
    // Holds the request, then lets the fixture handler answer it.
    msw.use(
      http.get("/api/ebooks", async () => {
        await gate;
      }),
      libraryHandler(BY_TWO_AUTHORS, 10),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("counting")).toBeInTheDocument();
    await expect(canvas.queryByText("0 books")).not.toBeInTheDocument();

    release();

    await expect(await canvas.findByText("3 books")).toBeInTheDocument();
    await expect(canvas.queryByText("counting")).not.toBeInTheDocument();
  },
};

export const FilterRestores: Story = {
  beforeEach({ msw }) {
    seedAdaFilter();
    requests.length = 0;
    msw.use(libraryHandler(BY_TWO_AUTHORS, 10, { requests }));
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(3));

    await expect(requests[0]?.get("filter")).toBe(ADA_FILTER);
    await expect(
      canvas.getByRole("button", { name: /^Author/ }),
    ).toHaveTextContent("AuthorAda Lovelace");
    await expect(
      canvas.getByRole("button", { name: "Clear all" }),
    ).toBeInTheDocument();
  },
};

export const FilterFailing: Story = {
  beforeEach({ msw }) {
    seedAdaFilter();
    msw.use(failing("get", "/api/ebooks", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the library",
    );
    await expect(canvas.queryByText("counting")).not.toBeInTheDocument();
  },
};

export const HiddenFormats: Story = {
  parameters: {
    user: { ...WIRE_ADA, hidden_formats: ["mp3", "m4b"] },
  },
  beforeEach({ msw }) {
    requests.length = 0;
    const audio = aWireLibrary(6).map((book, i) =>
      i % 3 === 0 ? { ...book, formats: ["MP3"] } : book,
    );
    msw.use(libraryHandler(audio, 10, { requests }));
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(4));

    await expect(requests[0]?.get("exclude_formats")).toBe("m4b,mp3");
    await expect(canvas.getByText("2 hidden")).toBeInTheDocument();
    const link = canvas.getByRole("link", { name: /^Hidden: M4B, MP3/ });
    await expect(link).toHaveAttribute("href", "/settings?section=preferences");
    await expect(link).toHaveTextContent(
      "Hidden: M4B, MP3. Change in Settings",
    );
  },
};

const SHELF_KEY = "omnibus.landing_shelf";
const WINTER = '{"kind":"shelf","id":3}';

const FIRST_COVER = uuidOf(1);

// Winter reads is hand-picked and summarises five books though it holds two.
const SHELF_LIST = [
  aWireShelf({ id: 3, book_count: 5, cover_uuids: [FIRST_COVER] }),
  aWireShelf({
    id: 5,
    kind: "smart",
    name: "Space Operas",
    visibility: "public",
    book_count: 12,
  }),
  aWireShelf({ id: 6, kind: "wishlist", name: "Wishlist", book_count: 1 }),
  aWireShelf({
    id: 7,
    name: "Book club",
    visibility: "public",
    owner_user_id: 2,
    owner_username: "bo",
    book_count: 3,
  }),
  aWireShelf({
    id: 8,
    name: "Bo's secrets",
    owner_user_id: 2,
    owner_username: "bo",
  }),
  aWireShelf({
    id: 9,
    kind: "wishlist",
    name: "Empty wishlist",
    book_count: 0,
  }),
];
const SHELVES = shelvesHandler(SHELF_LIST);

const SHELF_MEMBERS = BY_TWO_AUTHORS.slice(0, 4);

const shelfRequests: URLSearchParams[] = [];

export const Shelves: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(6), 10), SHELVES);
  },
  play: async ({ canvas }) => {
    const all = await canvas.findByRole("button", {
      name: "All Books, 6 books",
    });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(
      await canvas.findByRole("button", { name: "Winter reads, 5 books" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      canvas.getByRole("button", {
        name: "Smart shelf Space Operas, 12 books · Public",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Wishlist Wishlist, 1 book" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", {
        name: "Book club, 3 books · Public · by bo",
      }),
    ).toHaveTextContent("3 · bo");
    // Another reader's private shelf and an empty wishlist stay off the row.
    await expect(canvas.queryByText("Bo's secrets")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Empty wishlist")).not.toBeInTheDocument();

    const region = canvas.getByRole("region", { name: "Shelves" });
    await expect(
      within(region).getByRole("link", { name: "All shelves" }),
    ).toHaveAttribute("href", "/shelves");
    await expect(
      within(region).getByRole("button", { name: "Earlier shelves" }),
    ).toHaveAttribute("tabindex", "-1");
    await expect(
      within(region).getByRole("button", { name: "More shelves" }),
    ).toHaveAttribute("tabindex", "-1");
  },
};

export const ShelfLens: Story = {
  parameters: { user: { ...WIRE_ADA, hidden_formats: ["mp3"] } },
  beforeEach({ msw }) {
    shelfRequests.length = 0;
    msw.use(
      libraryHandler(aWireLibrary(6), 10),
      SHELVES,
      shelfPageHandler({ 3: SHELF_MEMBERS }, { requests: shelfRequests }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    await expect(
      canvas.getByRole("link", { name: /^Hidden: MP3/ }),
    ).toBeInTheDocument();

    await userEvent.click(
      await canvas.findByRole("button", { name: "Winter reads, 5 books" }),
    );

    await waitFor(() => expect(tiles(canvas)).toHaveLength(4));
    await expect(shelfRequests.at(-1)?.get("sort")).toBe("title");
    await expect(shelfRequests.at(-1)?.get("dir")).toBe("asc");
    await expect(shelfRequests.at(-1)?.has("exclude_formats")).toBe(false);
    // The loaded member list outranks the summary's count.
    await expect(
      canvas.getByRole("button", { name: "Winter reads, 4 books" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: /^Hidden:/ }),
    ).not.toBeInTheDocument();
  },
};

export const ShelfLensFiltered: Story = {
  beforeEach({ msw }) {
    seedAdaFilter();
    localStorage.setItem(SHELF_KEY, WINTER);
    shelfRequests.length = 0;
    msw.use(
      libraryHandler(BY_TWO_AUTHORS, 10),
      SHELVES,
      shelfPageHandler({ 3: SHELF_MEMBERS }, { requests: shelfRequests }),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(2));
    await expect(shelfRequests[0]?.get("filter")).toBe(ADA_FILTER);
    await expect(await canvas.findByText("2 books")).toBeInTheDocument();
    // The summary counts the whole shelf, so under a filter it stays put.
    await expect(
      canvas.getByRole("button", { name: "Winter reads, 5 books" }),
    ).toBeInTheDocument();
  },
};

export const ShelfEmpty: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(6), 10),
      SHELVES,
      shelfPageHandler({ 3: [] }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Winter reads, 5 books" }),
    );

    await expect(
      await canvas.findByText("No books in this shelf."),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("No ebooks found."),
    ).not.toBeInTheDocument();
  },
};

export const ShelfFailing: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(6), 10),
      SHELVES,
      failing("get", "/api/shelves/3/page", 500),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Winter reads, 5 books" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the library",
    );
  },
};

export const ShelvesLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks"), hanging("/api/shelves"));
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      canvas.getByRole("button", { name: "All Books, Your whole library" }),
    ).toBeInTheDocument();
    const pending = canvasElement.querySelectorAll(".lmq-shent-pending");
    await expect(pending).toHaveLength(3);
    await expect(pending[0]).toHaveAttribute("aria-hidden", "true");
  },
};

export const ShelvesFailing: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(6), 10),
      failing("get", "/api/shelves", 500),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelectorAll(".lmq-shent-pending")).toHaveLength(
        0,
      ),
    );
    await expect(
      await canvas.findByRole("button", { name: "All Books, 6 books" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: /^Winter reads/ }),
    ).not.toBeInTheDocument();
  },
};

export const ShelfPickPersists: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(6), 10),
      SHELVES,
      shelfPageHandler({ 3: SHELF_MEMBERS }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Winter reads, 5 books" }),
    );
    await expect(localStorage.getItem(SHELF_KEY)).toBe(WINTER);

    await userEvent.click(canvas.getByRole("button", { name: /^All Books/ }));
    await expect(localStorage.getItem(SHELF_KEY)).toBe('{"kind":"all"}');
  },
};

export const StaleShelfSnapsBack: Story = {
  beforeEach({ msw }) {
    localStorage.setItem(SHELF_KEY, '{"kind":"shelf","id":99}');
    msw.use(libraryHandler(aWireLibrary(6), 10), SHELVES, shelfPageHandler({}));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(localStorage.getItem(SHELF_KEY)).toBe('{"kind":"all"}'),
    );
    await expect(
      await canvas.findByRole("button", { name: /^All Books/ }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const ManualShelfSortLocked: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(6), 10),
      SHELVES,
      shelfPageHandler({ 3: SHELF_MEMBERS, 5: SHELF_MEMBERS }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Winter reads, 5 books" }),
    );

    await expect(await canvas.findByText("shelf order")).toBeInTheDocument();
    await expect(
      canvas.getByRole("combobox", { name: "Sort by" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: /^Sort direction/ }),
    ).toBeDisabled();

    await userEvent.click(canvas.getByRole("button", { name: "Table" }));

    await expect(canvas.getByText("shelf order")).toBeInTheDocument();
    for (const header of await canvas.findAllByRole("columnheader", {
      name: /^(Title|Author|Series|Last Updated|Added)/,
    })) {
      await expect(header).toHaveAttribute("aria-sort", "none");
      await expect(within(header).getByRole("button")).toBeDisabled();
    }

    // A smart shelf orders itself by the sort the reader picks.
    await userEvent.click(
      canvas.getByRole("button", { name: /^Smart shelf Space Operas/ }),
    );
    await waitFor(() =>
      expect(canvas.queryByText("shelf order")).not.toBeInTheDocument(),
    );
    await expect(
      canvas.getByRole("columnheader", { name: /^Title/ }),
    ).toHaveAttribute("aria-sort", "ascending");
  },
};

const volume = (series: string, n: number, index: number) =>
  aWireBook({
    id: n,
    title: `${series}, Vol. ${index}`,
    series,
    series_index: String(index),
    unique_identifier: uuidOf(n),
  });

// Two series and a standalone, in the order the server lists them before folding.
const STACK_BOOKS = [
  volume("Saga", 101, 1),
  volume("Saga", 102, 2),
  volume("Saga", 103, 3),
  volume("Duo", 201, 1),
  volume("Duo", 202, 2),
  aWireBook({
    id: 301,
    title: "Standalone",
    series: null,
    series_index: null,
    unique_identifier: uuidOf(301),
  }),
];

// Saga's first volume is finished and its second is 40% read.
const STACKS = [
  aWireStack({
    lead_uuid: uuidOf(101),
    members: STACK_BOOKS.slice(0, 3),
    states: [
      { uuid: uuidOf(101), started: true, finished: true },
      { uuid: uuidOf(102), started: true, percent: 40 },
    ],
  }),
  aWireStack({
    lead_uuid: uuidOf(201),
    name: "Duo",
    series_id: 8,
    members: STACK_BOOKS.slice(3, 5),
  }),
];

const STACKED_USER = { ...WIRE_ADA, stack_series: true };

export const StackedSeries: Story = {
  parameters: { user: STACKED_USER },
  beforeEach({ msw }) {
    requests.length = 0;
    msw.use(
      libraryHandler(STACK_BOOKS, 10, { requests, stacks: STACKS }),
      ...stackSeriesHandler(),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const saga = await canvas.findByRole("button", { name: "Saga, 3 books" });
    await expect(saga).toHaveAttribute("aria-expanded", "false");
    await expect(saga).toHaveTextContent("3 books · Sora Inkwell");
    await expect(
      canvas.getByRole("button", { name: "Duo, 2 books" }),
    ).toBeInTheDocument();
    // The stacks stand in for their leads; only the standalone keeps a tile.
    await expect(tiles(canvas)).toHaveLength(1);
    await expect(requests[0]?.get("stack_series")).toBe("true");

    const fills = [...saga.querySelectorAll<HTMLElement>(".ss-segs b")].map(
      (fill) => fill.style.width,
    );
    await expect(fills).toEqual(["100%", "40%", "0%"]);
    // The volume in progress fans in front.
    await expect(saga.querySelector(".ss-leaf img")).toHaveAttribute(
      "alt",
      "Cover of Saga, Vol. 2",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Table" }));

    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    await expect(requests.at(-1)?.has("stack_series")).toBe(false);
  },
};

export const DealOutAndFold: Story = {
  parameters: { user: STACKED_USER },
  beforeEach({ msw }) {
    msw.use(libraryHandler(STACK_BOOKS, 10, { stacks: STACKS }));
  },
  play: async ({ canvas, userEvent }) => {
    // The first deal-out is by keyboard, as a tile is a button.
    const saga = await canvas.findByRole("button", { name: "Saga, 3 books" });
    saga.focus();
    await userEvent.keyboard("{Enter}");

    const fold = await canvas.findByRole("button", { name: /^Fold up/ });
    await waitFor(() => expect(fold).toHaveFocus());
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Saga" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/^3 in your library/)).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Series page →" }),
    ).toHaveAttribute("href", "/series/7");
    await expect(canvas.getByText("Vol. 1 · read")).toBeInTheDocument();
    await expect(canvas.getByText("Vol. 2")).toBeInTheDocument();
    await expect(canvas.getByText("Vol. 3")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Saga, 3 books" }),
    ).not.toBeInTheDocument();

    // One run at a time: dealing out Duo folds Saga.
    await userEvent.click(canvas.getByRole("button", { name: "Duo, 2 books" }));
    await expect(
      await canvas.findByRole("heading", { level: 3, name: "Duo" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Saga, 3 books" }),
    ).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    const duo = await canvas.findByRole("button", { name: "Duo, 2 books" });
    await waitFor(() => expect(duo).toHaveFocus());
    await expect(canvas.queryByRole("heading", { level: 3 })).toBeNull();

    // The Fold up button puts focus back on the tile it folded into.
    await userEvent.click(duo);
    await userEvent.click(
      await canvas.findByRole("button", { name: /^Fold up/ }),
    );
    const folded = await canvas.findByRole("button", { name: "Duo, 2 books" });
    await waitFor(() => expect(folded).toHaveFocus());
  },
};

export const StackToggle: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    msw.use(
      libraryHandler(STACK_BOOKS, 10, { requests, stacks: STACKS }),
      ...stackSeriesHandler({ bodies, gate: holdRequests() }),
    );
    bodies.length = 0;
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    const toggle = canvas.getByRole("button", { name: "Stack series" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    toggle.focus();
    await userEvent.keyboard(" ");

    // The switch flips before the save answers, and stays put until it does.
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    // Keyboard focus stays on the switch while it waits.
    await expect(document.activeElement).toBe(toggle);
    release();
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-disabled", "false"),
    );
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(
      await canvas.findByRole("button", { name: "Saga, 3 books" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(bodies).toEqual([{ enabled: true }]));
    await expect(requests.at(-1)?.get("stack_series")).toBe("true");

    await userEvent.click(toggle);

    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-pressed", "false"),
    );
    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    await waitFor(() =>
      expect(bodies).toEqual([{ enabled: true }, { enabled: false }]),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Table" }));

    await expect(
      canvas.queryByRole("button", { name: "Stack series" }),
    ).not.toBeInTheDocument();
  },
};

export const StackToggleFails: Story = {
  beforeEach({ msw }) {
    let saves = 0;
    msw.use(
      libraryHandler(STACK_BOOKS, 10, { stacks: STACKS }),
      // The first save is refused; the next is held, to show the message clearing.
      http.post("/api/account/stack-series", async () => {
        saves += 1;
        if (saves > 1) await delay("infinite");
        return new HttpResponse("failed with 500", { status: 500 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));
    const toggle = canvas.getByRole("button", { name: "Stack series" });

    await userEvent.click(toggle);

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't save Stack series. Try again.",
    );
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(tiles(canvas)).toHaveLength(6));

    await userEvent.click(toggle);

    await waitFor(() =>
      expect(canvas.queryByRole("alert")).not.toBeInTheDocument(),
    );
  },
};

// Three open books: an ebook 42% read, an audiobook an hour into two at double speed, a synced one.
const AURORA = aWireResumePoint({ progress_percent: 42 });
const MARTIAN = {
  ...aWireResumePoint(
    {
      book_uuid: uuidOf(401),
      format: "audio",
      audio_position_seconds: 3600,
      total_duration_seconds: 7200,
      book_file_id: 7,
    },
    {
      id: 401,
      title: "The Martian",
      unique_identifier: uuidOf(401),
      formats: ["M4B"],
      accent: "oklch(0.6 0.1 200)",
    },
  ),
  audio_part: 3,
  playback_rate: 2,
};
const DUNE = {
  ...aWireResumePoint(
    { book_uuid: uuidOf(402), progress_percent: 10 },
    { id: 402, title: "Dune", unique_identifier: uuidOf(402) },
  ),
  linked: true,
};

const resumeRegion = (canvas: ReturnType<typeof within>) =>
  canvas.findByRole("region", { name: "Continue reading" });

function pageAccent(canvasElement: HTMLElement) {
  const root = canvasElement.querySelector("#lmq-root");
  if (!(root instanceof HTMLElement))
    throw new Error("the page root is missing");
  return root.style.getPropertyValue("--accent").trim();
}

export const ResumeStackShown: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(3), 10),
      recentProgressHandler([AURORA, MARTIAN, DUNE]),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const stack = within(await resumeRegion(canvas));

    const title = stack.getByRole("heading", {
      level: 2,
      name: "Aurora Station, Vol. 1",
    });
    await expect(title.closest("a")).toHaveAttribute(
      "href",
      "/books/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    );
    await expect(canvasElement.querySelector(".lmq-by")).toHaveTextContent(
      "Sora Inkwell · 42%",
    );
    const front = stack.getByRole("link", {
      name: "Continue reading: Aurora Station, Vol. 1",
    });
    await expect(front).toHaveAttribute(
      "href",
      "/read/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    );
    await expect(front).toHaveTextContent("resume · 42%");
    await expect(
      stack.getByRole("button", { name: "Bring The Martian forward" }),
    ).toBeInTheDocument();
    await expect(
      stack.getByRole("button", { name: "Bring Dune forward" }),
    ).toBeInTheDocument();
    await expect(pageAccent(canvasElement)).toBe("oklch(0.555 0.153 28.4)");
  },
};

const recent: Parameters<typeof recentProgressHandler>[0] = [];

export const BringForward: Story = {
  decorators: [withClient],
  beforeEach({ msw }) {
    recent.splice(0, recent.length, AURORA, MARTIAN, DUNE);
    msw.use(libraryHandler(aWireLibrary(3), 10), recentProgressHandler(recent));
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const stack = within(await resumeRegion(canvas));

    await userEvent.click(
      stack.getByRole("button", { name: "Bring The Martian forward" }),
    );

    await expect(
      stack.getByRole("heading", { level: 2, name: "The Martian" }),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector(".lmq-by")).toHaveTextContent(
      "Sora Inkwell · Pt. 3 · 50% · 30m left",
    );
    await expect(
      stack.getByRole("link", { name: "Continue listening: The Martian" }),
    ).toHaveAttribute("href", `/listen/${uuidOf(401)}?file_id=7`);
    await expect(
      stack.getByRole("button", {
        name: "Bring Aurora Station, Vol. 1 forward",
      }),
    ).toBeInTheDocument();
    await expect(pageAccent(canvasElement)).toBe("oklch(0.6 0.1 200)");

    await userEvent.click(
      stack.getByRole("button", { name: "Bring Dune forward" }),
    );

    await expect(
      stack.getByRole("link", { name: "Continue · synced: Dune" }),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector(".lmq-by")).toHaveTextContent(
      "synced",
    );

    // The feed reorders on a refetch, yet the book brought forward stays the lead.
    recent.reverse();
    await pageClient.invalidateQueries({ queryKey: ["progress", "recent"] });
    await expect(
      within(await resumeRegion(canvas)).getByRole("heading", {
        level: 2,
        name: "Dune",
      }),
    ).toBeInTheDocument();
  },
};

export const ResumeStackPending: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(3), 10),
      hanging("/api/progress/recent"),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const pending = canvasElement.querySelector(".lmq-stack-pending");
    await expect(pending).toHaveAttribute("aria-hidden", "true");
    await expect(
      canvas.queryByRole("region", { name: "Continue reading" }),
    ).not.toBeInTheDocument();
  },
};

export const NothingToResume: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(3), 10), recentProgressHandler([]));
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".lmq-stack-pending")).toBeNull(),
    );
    await expect(
      canvas.queryByRole("region", { name: "Continue reading" }),
    ).not.toBeInTheDocument();
  },
};

export const ResumeFailing: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(3), 10),
      failing("get", "/api/progress/recent", 500),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".lmq-stack-pending")).toBeNull(),
    );
    await expect(
      canvas.queryByRole("region", { name: "Continue reading" }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const ScrolledPastStack: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(60), 60),
      recentProgressHandler([AURORA]),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findAllByRole("link", { name: /^Open details for/ });
    const root = canvasElement.querySelector("#lmq-root");
    await expect(root).not.toHaveClass("lmq--past");

    window.scrollTo(0, 600);
    await waitFor(() => expect(root).toHaveClass("lmq--past"));

    window.scrollTo(0, 0);
    await waitFor(() => expect(root).not.toHaveClass("lmq--past"));
  },
};

const AURORA_1 = uuidOf(1);
const AURORA_2 = uuidOf(2);

// Fresh per story: the bulk handler edits these in place.
const bulkBooks = () =>
  aWireLibrary(3).map((book, i) => ({
    ...book,
    subjects: [["space opera", "cozy"], ["cozy", "found family"], []][i] ?? [],
  }));

const BULK_OPTIONS = filterOptionHandlers({
  tags: [
    { name: "space opera", count: 2 },
    { name: "cozy", count: 2 },
  ],
});

const saved: BulkOverridesRequest[] = [];

type Play = Pick<
  Parameters<NonNullable<Story["play"]>>[0],
  "canvas" | "userEvent"
>;

// Table view with the first two rows checked.
async function selectTwo({ canvas, userEvent }: Play) {
  await userEvent.click(
    await canvas.findByRole("checkbox", {
      name: "Select Aurora Station, Vol. 1",
    }),
  );
  await userEvent.click(
    canvas.getByRole("checkbox", { name: "Select Aurora Station, Vol. 2" }),
  );
}

// Those two rows checked and the bar's button pressed: the dialog it opens.
async function openFromBar(play: Play, button: string, dialog: string) {
  await selectTwo(play);
  await play.userEvent.click(play.canvas.getByRole("button", { name: button }));
  return within(play.canvas.getByRole("dialog", { name: dialog }));
}

const openBulkEdit = (play: Play) =>
  openFromBar(play, "Edit", "Bulk edit 2 books");

const openShelfPicker = (play: Play) =>
  openFromBar(play, "Add to shelf", "Add 2 books to a shelf");

// What a chip input offers: the values of its datalist.
function suggestions(field: HTMLElement) {
  return field instanceof HTMLInputElement
    ? [...(field.list?.options ?? [])].map((option) => option.value)
    : [];
}

export const BulkSelect: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(libraryHandler(aWireLibrary(150), 60));
  },
  play: async ({ canvas, userEvent }) => {
    const all = await canvas.findByRole("checkbox", {
      name: "Select all books",
    });
    await expect(canvas.queryByText(/selected$/)).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Select Aurora Station, Vol. 1" }),
    );
    await expect(canvas.getByText("1 book selected")).toBeInTheDocument();

    // Select all takes the 60 rows page 1 shows, not the 90 behind them.
    await userEvent.click(all);
    await expect(canvas.getByText("60 books selected")).toBeInTheDocument();
    await expect(all).toBeChecked();
    await userEvent.click(all);
    await expect(canvas.queryByText(/selected$/)).not.toBeInTheDocument();

    await userEvent.click(all);
    await userEvent.click(
      canvas.getByRole("button", { name: "Clear selection" }),
    );
    await expect(canvas.queryByText(/selected$/)).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("checkbox", { name: "Select Aurora Station, Vol. 1" }),
    ).not.toBeChecked();
  },
};

export const BulkSelectAdminOnly: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false } },
  beforeEach({ msw }) {
    seedTable();
    msw.use(libraryHandler(bulkBooks(), 2));
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("table");
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
  },
};

export const BulkEditApplies: Story = {
  beforeEach({ msw }) {
    seedTable();
    saved.length = 0;
    const books = bulkBooks();
    msw.use(
      libraryHandler(books, 10),
      bulkOverridesHandler(books, { saved }),
      ...BULK_OPTIONS,
    );
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openBulkEdit({ canvas, userEvent });
    const apply = form.getByRole("button", { name: "Apply to 2 books" });
    await expect(
      form.getByText("Blank fields are left unchanged on every book."),
    ).toBeInTheDocument();
    await expect(apply).toBeDisabled();

    // The books' own tags are all there is to remove, the most shared first.
    const remove = form.getByRole("combobox", { name: "Remove tags" });
    await expect(suggestions(remove)).toEqual([
      "cozy",
      "found family",
      "space opera",
    ]);
    await waitFor(() =>
      expect(
        suggestions(form.getByRole("combobox", { name: "Add tags" })),
      ).toEqual(["space opera", "cozy"]),
    );

    await userEvent.type(remove, "cozy{Enter}");
    await userEvent.type(
      form.getByRole("combobox", { name: "Add tags" }),
      "slow burn{Enter}",
    );
    await userEvent.type(form.getByLabelText("Publisher"), " Tor ");
    await userEvent.click(apply);

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // One request, with the deltas rather than any book's resulting lists.
    await expect(saved).toEqual([
      {
        uuids: [AURORA_1, AURORA_2],
        edit: {
          publisher: "Tor",
          add_tags: ["slow burn"],
          remove_tags: ["cozy"],
          add_genres: [],
          remove_genres: [],
        },
      },
    ]);
    // The lists refetched in place, and the selection went with the dialog.
    await waitFor(() =>
      expect(canvas.getAllByRole("row")[1]).toHaveTextContent(
        "space opera, slow burn",
      ),
    );
    await expect(canvas.getAllByRole("row")[2]).toHaveTextContent(
      "found family, slow burn",
    );
    await expect(canvas.queryByText(/selected$/)).not.toBeInTheDocument();
    // The Edit button left with the selection, so focus lands in the table.
    await expect(canvas.getByRole("table")).toContainElement(
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );
  },
};

export const BulkEditFails: Story = {
  beforeEach({ msw }) {
    seedTable();
    saved.length = 0;
    const gate = holdRequests();
    holding = false;
    msw.use(
      // Once `holding`, a refetch of the library waits on the gate.
      http.get("/api/ebooks", async () => {
        if (holding) await gate;
      }),
      libraryHandler(bulkBooks(), 10),
      bulkOverridesHandler([], { saved, refuse: "series too long" }),
      ...BULK_OPTIONS,
    );
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openBulkEdit({ canvas, userEvent });
    holding = true;

    await userEvent.type(form.getByLabelText("Series"), "Saga");
    await userEvent.click(
      form.getByRole("button", { name: "Apply to 2 books" }),
    );

    // A refused save changes nothing, so the alert must not wait on a refetch.
    await expect(await form.findByRole("alert")).toHaveTextContent(
      /^Save failed: series too long$/,
    );
    release();
    // The dialog and the selection stay, and nothing changed in the table.
    await expect(
      form.getByRole("button", { name: "Apply to 2 books" }),
    ).toBeEnabled();
    await expect(canvas.getByText("2 books selected")).toBeInTheDocument();
    await expect(canvas.getAllByRole("row")[1]).toHaveTextContent(
      "Aurora Station #1",
    );
  },
};

export const BulkEditApplying: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(
      libraryHandler(bulkBooks(), 10),
      hanging("/api/ebooks/overrides/bulk", "post"),
      ...BULK_OPTIONS,
    );
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openBulkEdit({ canvas, userEvent });

    await userEvent.type(form.getByLabelText("Publisher"), "Tor");
    await userEvent.click(
      form.getByRole("button", { name: "Apply to 2 books" }),
    );

    const busy = await form.findByRole("button", { name: "Applying…" });
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(busy).toBeDisabled();
    await expect(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // Nothing closes it mid-save.
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const BulkEditNothingToApply: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(libraryHandler(bulkBooks(), 10), ...BULK_OPTIONS);
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openBulkEdit({ canvas, userEvent });
    const apply = form.getByRole("button", { name: "Apply to 2 books" });
    const publisher = form.getByLabelText("Publisher");

    // Blank space changes nothing.
    await userEvent.type(publisher, "  ");
    await expect(apply).toBeDisabled();
    await userEvent.type(publisher, "Tor");
    await expect(apply).toBeEnabled();
    await userEvent.clear(publisher);
    await expect(apply).toBeDisabled();

    // Escape closes it and hands focus back to the button that opened it.
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Edit" })).toHaveFocus();
    await expect(canvas.getByText("2 books selected")).toBeInTheDocument();

    // A press that starts in the card and is released on the backdrop keeps it open.
    await userEvent.click(canvas.getByRole("button", { name: "Edit" }));
    const dialog = canvas.getByRole("dialog");
    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: within(dialog).getByRole("heading") },
      { target: dialog },
      { keys: "[/MouseLeft]" },
    ]);
    await expect(dialog).toBeInTheDocument();

    // A click on the backdrop closes it.
    await userEvent.click(dialog);
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const SelectionClearsOnSort: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(libraryHandler(bulkBooks(), 10));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("checkbox", {
        name: "Select Aurora Station, Vol. 1",
      }),
    );
    await expect(canvas.getByText("1 book selected")).toBeInTheDocument();

    await userEvent.click(
      within(canvas.getByRole("columnheader", { name: /^Author/ })).getByRole(
        "button",
      ),
    );

    await waitFor(() =>
      expect(canvas.queryByText(/selected$/)).not.toBeInTheDocument(),
    );
    await expect(
      await canvas.findByRole("checkbox", {
        name: "Select Aurora Station, Vol. 1",
      }),
    ).not.toBeChecked();
  },
};

let shelfReads = 0;
const added: { id: number; uuids: string[] }[] = [];

export const BulkAddToShelf: Story = {
  beforeEach({ msw }) {
    seedTable();
    added.length = 0;
    shelfReads = 0;
    requests.length = 0;
    msw.use(
      libraryHandler(bulkBooks(), 10, { requests }),
      http.get("/api/shelves", () => {
        shelfReads += 1;
        return HttpResponse.json(SHELF_LIST);
      }),
      addShelfBooksHandler({ added }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openShelfPicker({ canvas, userEvent });

    // The admin may file on another reader's hand-picked shelf, never on a smart one or a wishlist.
    await expect(
      form.getByRole("button", { name: /^Book club/ }),
    ).toHaveTextContent("3 books · bo");
    await expect(
      form.queryByRole("button", { name: /Space Operas/ }),
    ).toBeNull();
    await expect(form.queryByRole("button", { name: /Wishlist/ })).toBeNull();
    const reads = shelfReads;
    const listings = requests.length;

    await userEvent.click(form.getByRole("button", { name: /^Winter reads/ }));

    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(added).toEqual([{ id: 3, uuids: [AURORA_1, AURORA_2] }]);
    await expect(canvas.queryByText(/selected$/)).not.toBeInTheDocument();
    // The shelves refetch, so the new count shows.
    await waitFor(() => expect(shelfReads).toBeGreaterThan(reads));
    // So does the library list, which a shelf filter narrows.
    await waitFor(() => expect(requests.length).toBeGreaterThan(listings));
  },
};

export const BulkAddToShelfFails: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(
      libraryHandler(bulkBooks(), 10),
      SHELVES,
      addShelfBooksHandler({ refuse: "not your shelf" }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openShelfPicker({ canvas, userEvent });
    const winter = form.getByRole("button", { name: /^Winter reads/ });

    await userEvent.click(winter);

    await expect(await form.findByRole("alert")).toHaveTextContent(
      "Couldn't add to Winter reads: not your shelf",
    );
    // Everything stays as it was, ready for another try.
    await expect(winter).toBeEnabled();
    await expect(canvas.getByText("2 books selected")).toBeInTheDocument();
  },
};

export const BulkAddNoShelves: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(
      libraryHandler(bulkBooks(), 10),
      shelvesHandler([aWireShelf({ id: 5, kind: "smart" })]),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openShelfPicker({ canvas, userEvent });

    await expect(
      form.getByText("You have no hand-picked shelves yet."),
    ).toBeInTheDocument();
    await expect(
      form.getByRole("link", { name: "shelves page →" }),
    ).toHaveAttribute("href", "/shelves");

    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Add to shelf" }),
    ).toHaveFocus();
  },
};

export const BulkAddShelvesFailing: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(
      libraryHandler(bulkBooks(), 10),
      failing("get", "/api/shelves", 500),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openShelfPicker({ canvas, userEvent });

    await expect(
      await form.findByText(
        "Your shelves didn’t load. Close this and try again.",
      ),
    ).toBeInTheDocument();
  },
};

export const BulkAddShelvesLoading: Story = {
  beforeEach({ msw }) {
    seedTable();
    msw.use(libraryHandler(bulkBooks(), 10), hanging("/api/shelves"));
  },
  play: async ({ canvas, userEvent }) => {
    const form = await openShelfPicker({ canvas, userEvent });

    await expect(form.getByRole("status")).toHaveTextContent(
      "Gathering your shelves",
    );
  },
};

// Wider than any row the story can be drawn in.
const MANY_SHELVES = Array.from({ length: 24 }, (_, i) =>
  aWireShelf({ id: 10 + i, name: `Shelf number ${i + 1}`, book_count: i + 1 }),
);

export const ShelfRowArrows: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(3), 10), shelvesHandler(MANY_SHELVES));
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const row = canvasElement.querySelector("#lmq-shelf-row");
    if (!row) throw new Error("the shelves row is missing");
    const more = await canvas.findByRole("button", { name: "More shelves" });
    const earlier = canvas.getByRole("button", { name: "Earlier shelves" });

    // At the start only forward is lit, and only the lit arrow takes Tab.
    await waitFor(() => expect(more).toHaveClass("on"));
    await expect(more).toHaveAttribute("tabindex", "0");
    await expect(earlier).not.toHaveClass("on");
    await expect(earlier).toHaveAttribute("tabindex", "-1");

    await userEvent.click(more);
    await waitFor(() => expect(earlier).toHaveClass("on"));
    await expect(earlier).toHaveAttribute("tabindex", "0");
    const paged = row.scrollLeft;
    await expect(paged).toBeGreaterThan(0);

    await userEvent.click(earlier);
    await waitFor(() => expect(row.scrollLeft).toBeLessThan(paged));
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import {
  failing,
  filterOptionHandlers,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
  shelfPageHandler,
  shelvesHandler,
} from "../../testing/handlers";
import { aWireLibrary, aWireShelf, WIRE_ADA } from "../../testing/wire";
import { Library } from "./Library";

const PREFS_KEY = `omnibus.view_prefs::${LIBRARY_PATH}`;

const meta = {
  title: "Pages/Library",
  component: Library,
  // The three keys the page reads, so no story inherits another's prefs.
  beforeEach({ msw }) {
    msw.use(shelvesHandler([]));
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

const TABLE_PREFS = '{"view_mode":"table","sort_key":"title","sort_dir":"asc"}';

// Opens straight into the table, as a reader who left it there would.
function seedTable() {
  localStorage.setItem("omnibus.view_prefs.last_library", LIBRARY_PATH);
  localStorage.setItem(PREFS_KEY, TABLE_PREFS);
}

// Enough rows per page that "Load more" starts beyond the 400px the scroll observer watches.
const pageable = (count: number) => aWireLibrary(count);

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(pageable(40), 30));
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

const TABLE_BOOKS = pageable(150).map((book, i) =>
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
    await expect(row).toHaveTextContent("Aug 1st, 2026");
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

let release: () => void = () => {};

export const FilteredCounting: Story = {
  beforeEach({ msw }) {
    seedAdaFilter();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
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

const FIRST_COVER = "00000000-0000-4000-8000-000000000001";

// Winter reads is hand-picked and summarises five books though it holds two.
const SHELVES = shelvesHandler([
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
]);

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
    msw.use(libraryHandler(aWireLibrary(6), 10), SHELVES);
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

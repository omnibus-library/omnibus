import type { Meta, StoryObj } from "@storybook/react-vite";
import { http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import {
  failing,
  filterOptionHandlers,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
} from "../../testing/handlers";
import { aWireLibrary, WIRE_ADA } from "../../testing/wire";
import { Library } from "./Library";

const PREFS_KEY = `omnibus.view_prefs::${LIBRARY_PATH}`;

const meta = {
  title: "Pages/Library",
  component: Library,
  // The three keys the page reads, so no story inherits another's prefs.
  beforeEach() {
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

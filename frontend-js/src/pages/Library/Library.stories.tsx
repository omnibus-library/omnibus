import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import {
  failing,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
} from "../../testing/handlers";
import { aWireLibrary } from "../../testing/wire";
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

// A page of 30 puts "Load more" past the 400px the scroll observer watches.
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

const TABLE_BOOKS = pageable(90).map((book, i) =>
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
    msw.use(libraryHandler(TABLE_BOOKS, 30));
  },
  play: async ({ canvas, userEvent }) => {
    const rows = () =>
      canvas.queryAllByRole("link", { name: /^Open details for/ });
    await waitFor(() => expect(rows()).toHaveLength(30));

    await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(rows()).toHaveLength(60));

    // The observer takes the last page as the button nears the viewport.
    canvas.getByRole("button", { name: "Load more" }).scrollIntoView();
    await waitFor(() => expect(rows()).toHaveLength(90));
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

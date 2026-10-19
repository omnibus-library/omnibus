import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import {
  failing,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
  previewHandler,
  shelfDetailHandlers,
} from "../../testing/handlers";
import {
  aWireLibrary,
  aWireRulePreview,
  aWireShelfDetail,
  uuidOf,
} from "../../testing/wire";
import type { ShelfDetail } from "./ShelfDetail";
import {
  BOB,
  LIBRARY_KEY,
  MEMBERS,
  NOT_ADMIN,
  PREFS_KEY,
  shelfDetailMeta,
  writes,
} from "./shelfDetailMeta";

const meta = {
  ...shelfDetailMeta,
  title: "Pages/ShelfBooks",
} satisfies Meta<typeof ShelfDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

const ADA = '[{"field":"author","mode":"include","values":["Ada Lovelace"]}]';
const NOBODY = '[{"field":"author","mode":"include","values":["Nobody"]}]';

// A reader who browsed the library with this filter set.
const saveLibraryFilter = (clauses: string) => {
  localStorage.setItem(LIBRARY_KEY, LIBRARY_PATH);
  localStorage.setItem(
    PREFS_KEY,
    `{"view_mode":"grid","sort_key":"title","sort_dir":"asc","filters":{"clauses":${clauses}}}`,
  );
};

const titles = (canvas: ReturnType<typeof within>) =>
  canvas
    .getAllByTestId("shelf-tile")
    .map((tile: HTMLElement) => tile.textContent);

export const Members: Story = {
  play: async ({ canvas }) => {
    const grid = await canvas.findByTestId("shelf-grid");
    await waitFor(() => expect(titles(canvas)).toHaveLength(3));
    await expect(grid).toHaveAttribute("role", "list");
    await expect(titles(canvas)).toEqual([
      "Winter book 1",
      "Winter book 2",
      "Winter book 3",
    ]);
    await expect(canvas.getByTestId("shelf-count")).toHaveTextContent("3");
    await expect(
      canvas.getByLabelText("Open details for Winter book 2"),
    ).toHaveAttribute("href", `/books/${uuidOf(2)}`);
    await expect(
      canvas.getByRole("button", {
        name: "Remove Winter book 1 from this shelf",
      }),
    ).toBeEnabled();
    await expect(canvas.getByTestId("shelf-add-tile")).toHaveTextContent(
      "Add books",
    );
    await expect(canvas.queryByRole("combobox", { name: "Sort" })).toBeNull();
  },
};

export const MembersPending: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves/:id/page"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("shelf-count-pending"),
    ).toHaveTextContent("counting");
    await expect(canvas.getByTestId("shelf-loading")).toHaveTextContent(
      "Taking the books off the shelf",
    );
  },
};

export const OtherReadersCannotRemove: Story = {
  parameters: { user: NOT_ADMIN },
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(
        aWireShelfDetail({ visibility: "public", ...BOB }),
        MEMBERS,
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(titles(canvas)).toHaveLength(3));
    await expect(canvas.queryByRole("button", { name: /^Remove / })).toBeNull();
    await expect(canvas.queryByTestId("shelf-add-tile")).toBeNull();
  },
};

export const RemoveSuccess: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Remove Winter book 1 from this shelf",
      }),
    );

    await waitFor(() =>
      expect(titles(canvas)).toEqual(["Winter book 2", "Winter book 3"]),
    );
    await expect(writes).toEqual([{ op: "remove", uuid: uuidOf(1) }]);
    await expect(canvas.getByTestId("shelf-count")).toHaveTextContent("2");
    await expect(canvas.queryByTestId("shelf-remove-error")).toBeNull();
  },
};

export const RemoveFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("delete", "/api/shelves/:id/books/:uuid", 500));
  },
  play: async ({ canvas, userEvent }) => {
    const remove = await canvas.findByRole("button", {
      name: "Remove Winter book 1 from this shelf",
    });

    await userEvent.click(remove);

    await expect(
      await canvas.findByTestId("shelf-remove-error"),
    ).toHaveTextContent(
      "Couldn’t remove “Winter book 1” from this shelf: failed with 500",
    );
    await expect(titles(canvas)).toHaveLength(3);
    await expect(remove).toBeEnabled();
  },
};

const asked: URLSearchParams[] = [];

export const Filtered: Story = {
  beforeEach({ msw }) {
    asked.length = 0;
    saveLibraryFilter(ADA);
    msw.use(
      ...shelfDetailHandlers(aWireShelfDetail(), MEMBERS, writes, {
        requests: asked,
      }),
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(titles(canvas)).toEqual(["Winter book 1", "Winter book 2"]),
    );
    await expect(canvas.getByTestId("shelf-count")).toHaveTextContent("2");
    await expect(asked.map((r) => r.get("filter"))).toContain(ADA);
  },
};

export const FilteredOut: Story = {
  beforeEach({ msw }) {
    saveLibraryFilter(NOBODY);
    msw.use(...shelfDetailHandlers(aWireShelfDetail(), MEMBERS, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText("No books on this shelf match these filters."),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("shelf-grid")).toBeNull();

    await userEvent.click(
      canvas.getByRole("button", { name: "Clear filters" }),
    );

    await waitFor(() => expect(titles(canvas)).toHaveLength(3));
    // The cleared filter is filed back where the library reads it.
    await expect(
      JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").filters.clauses,
    ).toEqual([]);
  },
};

const sorts: URLSearchParams[] = [];

export const SmartSort: Story = {
  beforeEach({ msw }) {
    sorts.length = 0;
    msw.use(
      ...shelfDetailHandlers(
        aWireShelfDetail({ kind: "smart", rules: [] }),
        MEMBERS,
        writes,
        { requests: sorts },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const sort = await canvas.findByRole("combobox", { name: "Sort" });
    await expect(sort).toHaveValue("recently_interacted");
    await waitFor(() => expect(sorts.at(-1)?.get("dir")).toBe("desc"));
    await expect(sorts.at(-1)?.get("sort")).toBe("recently_interacted");
    await expect(canvas.queryByRole("button", { name: /^Remove / })).toBeNull();

    await userEvent.selectOptions(sort, "title");

    await waitFor(() => expect(sorts.at(-1)?.get("sort")).toBe("title"));
    await expect(sorts.at(-1)?.get("dir")).toBe("asc");
  },
};

export const RefetchFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/shelves/:id/page", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("shelf-refetch-error"),
    ).toHaveTextContent(
      "Couldn’t refresh this shelf. Check your connection and try again.",
    );
    await expect(canvas.queryByTestId("shelf-count")).toBeNull();
    await expect(canvas.queryByTestId("shelf-empty")).toBeNull();
    // Without the member list the tile would open a picker that marks nothing as already added.
    await expect(canvas.queryByTestId("shelf-add-tile")).toBeNull();
    await expect(canvas.getByTestId("shelf-add-books")).toHaveAttribute(
      "title",
      "This shelf’s books couldn’t be loaded.",
    );
  },
};

const withMembers = (shelf: Parameters<typeof aWireShelfDetail>[0]) =>
  ({
    beforeEach({ msw }) {
      msw.use(...shelfDetailHandlers(aWireShelfDetail(shelf), [], writes));
    },
  }) satisfies Story;

export const EmptyManual: Story = {
  beforeEach({ msw }) {
    msw.use(
      libraryHandler(aWireLibrary(2), 100),
      ...shelfDetailHandlers(aWireShelfDetail(), [], writes),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByTestId("shelf-empty")).toHaveTextContent(
      "No books on this shelf yet.",
    );
    await expect(canvas.getByTestId("shelf-count")).toHaveTextContent("0");

    await userEvent.click(canvas.getByTestId("shelf-empty-add"));

    await expect(
      await canvas.findByRole("dialog", { name: "Winter reads" }),
    ).toBeInTheDocument();
  },
};

export const EmptySmart: Story = {
  beforeEach({ msw }) {
    msw.use(
      previewHandler([], aWireRulePreview()),
      ...shelfDetailHandlers(
        aWireShelfDetail({
          kind: "smart",
          rules: [{ field: "tag", op: "is", value: "Fantasy" }],
        }),
        [],
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByTestId("shelf-empty")).toHaveTextContent(
      "No books match this shelf’s rules yet.",
    );

    await userEvent.click(canvas.getByTestId("shelf-empty-edit"));

    await expect(
      await canvas.findByRole("dialog", { name: "Edit shelf" }),
    ).toBeInTheDocument();
  },
};

export const EmptyWishlist: Story = {
  ...withMembers({ kind: "wishlist", name: "Wishlist" }),
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("shelf-empty")).toHaveTextContent(
      "Nothing on this wishlist yet.",
    );
    await expect(canvas.queryByTestId("shelf-empty-add")).toBeNull();
    await expect(canvas.queryByTestId("shelf-empty-edit")).toBeNull();
  },
};

export const AddBooks: Story = {
  beforeEach({ msw }) {
    const library = aWireLibrary(6);
    msw.use(
      libraryHandler(library, 100),
      ...shelfDetailHandlers(aWireShelfDetail(), MEMBERS, writes, {
        pool: library,
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("shelf-add-books")).toHaveAttribute(
        "aria-disabled",
        "false",
      ),
    );
    await userEvent.click(canvas.getByTestId("shelf-add-tile"));
    const dialog = await canvas.findByRole("dialog", {
      name: "Winter reads",
    });
    // The shelf's own books read as already on it.
    await expect(
      await within(dialog).findByTestId(`picker-tile-${uuidOf(1)}`),
    ).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(
      within(dialog).getByTestId(`picker-tile-${uuidOf(4)}`),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add 1 book" }),
    );

    await waitFor(() => expect(titles(canvas)).toHaveLength(4));
    await expect(writes).toEqual([{ op: "add", uuids: [uuidOf(4)] }]);
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(canvas.getByTestId("shelf-count")).toHaveTextContent("4");
  },
};

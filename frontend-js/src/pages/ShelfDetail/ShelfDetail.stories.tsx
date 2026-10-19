import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { getGetShelfMockHandler404 } from "../../api/generated/omnibus.msw";
import {
  failing,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
  previewHandler,
  type ShelfWrite,
  shelfDetailHandlers,
  shelvesHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireLibrary,
  aWireRulePreview,
  aWireShelfDetail,
  uuidOf,
  WIRE_ADA,
} from "../../testing/wire";
import { ShelfDetail } from "./ShelfDetail";

const BOB = { owner_user_id: 2, owner_username: "bob" };
const NOT_ADMIN = { ...WIRE_ADA, is_admin: false };

// Two by Ada, one by Sora, so a filter has something to rule out.
const MEMBERS = [1, 2, 3].map((n) =>
  aWireBook({
    id: n,
    title: `Winter book ${n}`,
    unique_identifier: uuidOf(n),
    cover_url: `/api/covers/${uuidOf(n)}`,
    creators: [
      {
        name: n < 3 ? "Ada Lovelace" : "Sora Inkwell",
        role: null,
        file_as: null,
        id: n,
      },
    ],
  }),
);

const LIBRARY_KEY = "omnibus.view_prefs.last_library";
const PREFS_KEY = `omnibus.view_prefs::${LIBRARY_PATH}`;
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

const writes: ShelfWrite[] = [];

const meta = {
  title: "Pages/ShelfDetail",
  component: ShelfDetail,
  parameters: { path: "/shelves/3" },
  beforeEach({ msw }) {
    writes.length = 0;
    localStorage.removeItem(LIBRARY_KEY);
    localStorage.removeItem(PREFS_KEY);
    msw.use(
      shelvesHandler([]),
      ...shelfDetailHandlers(aWireShelfDetail(), MEMBERS, writes),
    );
  },
  render: () => (
    <Routes>
      <Route path="/shelves/:id" element={<ShelfDetail />} />
      <Route path="/shelves" element={<p>The shelves index</p>} />
    </Routes>
  ),
} satisfies Meta<typeof ShelfDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

const action = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.getByRole("button", { name });

export const Owner: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Winter reads" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("shelf-kicker")).toHaveTextContent(
      "Hand-picked shelfPrivate3 books",
    );
    await expect(canvas.getByTestId("shelf-owner")).toHaveTextContent(
      "Your shelf",
    );
    await expect(
      canvas.getByRole("navigation", { name: "Breadcrumb" }),
    ).toHaveTextContent("← All shelves");
    await expect(canvas.queryByRole("note")).toBeNull();
    await waitFor(() => expect(document.title).toBe("Omnibus | Winter reads"));
    // Add books waits until the members have landed.
    await waitFor(() =>
      expect(canvas.getByTestId("shelf-add-books")).toHaveAttribute(
        "aria-disabled",
        "false",
      ),
    );
    await expect(action(canvas, "Edit shelf")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await expect(
      action(canvas, "Edit shelf").classList.contains("primary"),
    ).toBe(false);
  },
};

export const AddBooksWaitsForMembers: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves/:id/page"));
  },
  play: async ({ canvas, userEvent }) => {
    const add = await canvas.findByRole("button", { name: "Add books" });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(add).toHaveAttribute(
      "title",
      "Still loading this shelf’s books…",
    );

    await userEvent.click(add);

    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(canvas.queryByTestId("shelf-add-tile")).toBeNull();
  },
};

export const Smart: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(
        aWireShelfDetail({
          kind: "smart",
          match_mode: "any",
          description: "Cosy things.",
          rules: [
            { field: "tag", op: "is", value: "Fantasy" },
            { field: "year", op: "gte", value: "2020" },
          ],
        }),
        MEMBERS,
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    const rules = await canvas.findByTestId("shelf-rules");
    await expect(rules).toHaveTextContent(
      "Books matching any ofTag is FantasyYear is at least 2020",
    );
    await expect(canvas.getByText("Cosy things.")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Add books" }),
    ).toBeNull();
    await expect(
      action(canvas, "Edit shelf").classList.contains("primary"),
    ).toBe(true);
  },
};

export const OtherReader: Story = {
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
  play: async ({ canvas, userEvent }) => {
    const note = await canvas.findByRole("note");
    await expect(note).toHaveTextContent(
      "You can’t edit this shelf — it belongs to bob.",
    );
    await expect(note).toHaveTextContent(
      "Only its owner or an admin can rename it, change its books, or delete it.",
    );
    await expect(canvas.getByTestId("shelf-owner")).toHaveTextContent(
      "Owned by",
    );
    await expect(canvas.getByTestId("shelf-owner-name")).toHaveTextContent(
      "bob",
    );
    for (const name of ["Add books", "Edit shelf", "More shelf actions"]) {
      const button = action(canvas, name);
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAccessibleDescription(/You can’t edit/);
      await expect(button).toHaveAttribute(
        "title",
        "You can’t edit this shelf — it belongs to bob.",
      );
    }

    await userEvent.click(action(canvas, "Edit shelf"));
    await userEvent.click(action(canvas, "More shelf actions"));

    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(canvas.queryByRole("menu")).toBeNull();
  },
};

export const AdminOnOthers: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(aWireShelfDetail({ ...BOB }), MEMBERS, writes),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("shelf-owner")).toHaveTextContent(
      "Owned by",
    );
    await expect(canvas.getByTestId("shelf-owner-name")).toHaveTextContent(
      "bob",
    );
    await expect(canvas.queryByRole("note")).toBeNull();
    await expect(action(canvas, "Edit shelf")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await expect(action(canvas, "More shelf actions")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  },
};

export const Wishlist: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(
        aWireShelfDetail({ kind: "wishlist", name: "Wishlist" }),
        MEMBERS,
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    const note = await canvas.findByRole("note");
    await expect(note).toHaveTextContent("Your wishlist can’t be edited here.");
    await expect(canvas.getByTestId("shelf-owner")).toHaveTextContent(
      "Your shelf",
    );
    await expect(action(canvas, "Edit shelf")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const KoboToggle: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "More shelf actions" }),
    );
    const toggle = canvas.getByRole("menuitemcheckbox", {
      name: "Sync to Kobo",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(canvas.queryByTestId("shelf-kobo-badge")).toBeNull();

    await userEvent.click(toggle);

    await expect(
      await canvas.findByTestId("shelf-kobo-badge"),
    ).toHaveTextContent("Syncs to Kobo");
    await expect(writes).toEqual([
      { op: "patch", body: { sync_to_kobo: true } },
    ]);
    await expect(canvas.queryByRole("menu")).toBeNull();

    await userEvent.click(action(canvas, "More shelf actions"));
    await expect(
      canvas.getByRole("menuitemcheckbox", { name: "Sync to Kobo" }),
    ).toHaveAttribute("aria-checked", "true");
  },
};

export const KoboToggleFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("patch", "/api/shelves/:id", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "More shelf actions" }),
    );

    await userEvent.click(
      canvas.getByRole("menuitemcheckbox", { name: "Sync to Kobo" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t change Kobo sync: failed with 500",
    );
    await expect(canvas.queryByTestId("shelf-kobo-badge")).toBeNull();
  },
};

export const EditSaved: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit shelf" }),
    );
    const dialog = await canvas.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: "Shelf name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Spring reads");

    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Spring reads" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).toBeNull();
  },
};

const openDelete = async (
  canvas: ReturnType<typeof within>,
  userEvent: { click: (el: Element) => Promise<void> },
) => {
  await userEvent.click(
    await canvas.findByRole("button", { name: "More shelf actions" }),
  );
  await userEvent.click(canvas.getByRole("menuitem", { name: "Delete shelf" }));
  return canvas.findByRole("dialog", { name: "Delete shelf?" });
};

export const DeleteSuccess: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await openDelete(canvas, userEvent);
    await expect(dialog).toHaveTextContent(
      "Deleting “Winter reads” removes the shelf. Its books stay in your library. This can’t be undone.",
    );

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );

    await expect(
      await canvas.findByText("The shelves index"),
    ).toBeInTheDocument();
    await expect(writes).toEqual([{ op: "delete" }]);
  },
};

export const DeleteFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("delete", "/api/shelves/:id", 500));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await openDelete(canvas, userEvent);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t delete this shelf: failed with 500",
    );
    await expect(
      within(dialog).getByRole("button", { name: "Delete" }),
    ).toBeEnabled();
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Winter reads" }),
    ).toBeInTheDocument();
  },
};

export const DeleteWorkingIgnoresDismissal: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves/:id", "delete"));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await openDelete(canvas, userEvent);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );
    await expect(
      await within(dialog).findByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(getGetShelfMockHandler404());
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Shelf not found.",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to shelves" }),
    ).toHaveAttribute("href", "/shelves");
    await expect(
      canvas.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
  },
};

export const MalformedId: Story = {
  parameters: { path: "/shelves/0" },
  play: async ({ canvas }) => {
    // The default handlers answer any id, so a request would have drawn the shelf.
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Shelf not found.",
    );
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/shelves/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to shelves" }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves/:id"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Opening the shelf"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
  },
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
      await canvas.findByRole("dialog", { name: "Add books to Winter reads" }),
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
      name: "Add books to Winter reads",
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

import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { deferred, failing } from "../../testing/handlers";
import { readerFixture, SAVED_CFI, UUID } from "../../testing/readerStory";
import { aWireBookmark, aWireHighlight } from "../../testing/wire";
import { Reader } from "./Reader";

const r = readerFixture();

const meta = {
  title: "Pages/Reader/Bookmarks",
  component: Reader,
  parameters: { path: `/read/${UUID}` },
  beforeEach: ({ msw }) => r.setup(msw),
  render: () => (
    <Routes>
      <Route path="/read/:uuid" element={<Reader />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  ),
} satisfies Meta<typeof Reader>;

export default meta;
type Story = StoryObj<typeof meta>;

type Args = Pick<
  Parameters<NonNullable<Story["play"]>>[0],
  "canvas" | "userEvent"
>;

const BOOKMARKS = () => [
  aWireBookmark({
    id: 1,
    position: "epubcfi(/6/4!/4/2/1:0)",
    title: "Prologue",
  }),
  aWireBookmark({ id: 2, position: "epubcfi(/6/8!/4/2/1:0)", title: null }),
];

const HIGHLIGHTS = () => [
  aWireHighlight({ id: 1, color: "amber", text: "The amber passage" }),
  aWireHighlight({ id: 2, color: "green", text: "The green passage" }),
];

/** Waits out the bookmark list's load, which would replace a row added before it landed. */
const loaded = (panel: HTMLElement) =>
  waitFor(() => expect(within(panel).queryByRole("status")).toBeNull());

/** Waits for the book, then opens the bookmarks drawer. */
async function openDrawer({ canvas, userEvent }: Args) {
  await canvas.findByTestId("reader-header-chapter");
  await userEvent.click(canvas.getByRole("button", { name: "Bookmarks" }));
  const drawer = await canvas.findByTestId("reader-bookmarks-drawer");
  await loaded(drawer);
  return drawer;
}

/** The first row's delete button, once the list has loaded. */
async function firstDelete(drawer: HTMLElement) {
  const [first] = await within(drawer).findAllByRole("button", {
    name: "Delete bookmark",
  });
  if (!first) throw new Error("no bookmark rows");
  return first;
}

/** The phone toolbar's button is hidden at the story's width, so it is pressed by test id. */
async function openSheet({ canvas, userEvent }: Args) {
  await canvas.findByTestId("reader-header-chapter");
  await userEvent.click(canvas.getByTestId("reader-annotations"));
  const sheet = await canvas.findByTestId("reader-annotations-drawer");
  await loaded(sheet);
  return sheet;
}

export const TheDrawerIsEmptyBeforeAnyBookmark: Story = {
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await expect(drawer).toHaveTextContent(
      "No bookmarks yet. Tap + Bookmark to save your place.",
    );
    await expect(drawer).toHaveTextContent("Bookmarks 0");
  },
};

export const TheDrawerListsEverySavedPlace: Story = {
  beforeEach() {
    r.annotations.bookmarks = BOOKMARKS();
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    const rows = await within(drawer).findAllByTestId("reader-bookmark-row");
    await expect(rows.map((row) => row.textContent)).toEqual([
      "⚑Prologue×",
      "⚑Bookmark×",
    ]);
    await expect(drawer).toHaveTextContent("Bookmarks 2");
  },
};

export const AddingSavesTheCurrentPlaceTitledByTheChapter: Story = {
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await userEvent.click(
      within(drawer).getByRole("button", { name: "+ Bookmark" }),
    );

    await expect(await within(drawer).findByText("Prologue")).toHaveClass(
      "rd-bm-label",
    );
    await expect(r.annotationWrites).toEqual([
      {
        method: "POST",
        path: "/api/bookmarks",
        body: { book_uuid: UUID, position: SAVED_CFI, title: "Prologue" },
      },
    ]);
    await expect(drawer).toHaveTextContent("Bookmarks 1");
  },
};

export const AddingIsDisabledUntilThePositionIsKnown: Story = {
  // A glue that never reports a location.
  beforeEach: () => r.install({ onInit() {} }),
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(r.inits()).toHaveLength(1));
    await userEvent.click(canvas.getByRole("button", { name: "Bookmarks" }));
    const drawer = await canvas.findByTestId("reader-bookmarks-drawer");

    await expect(
      within(drawer).getByRole("button", { name: "+ Bookmark" }),
    ).toBeDisabled();
  },
};

const refused = { count: 0 };

export const ARefusedSaveAddsNothing: Story = {
  beforeEach({ msw }) {
    refused.count = 0;
    msw.use(
      http.post("/api/bookmarks", () => {
        refused.count += 1;
        return new HttpResponse("failed", { status: 500 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await userEvent.click(
      within(drawer).getByRole("button", { name: "+ Bookmark" }),
    );

    await waitFor(() => expect(refused.count).toBe(1));
    await expect(drawer).toHaveTextContent("No bookmarks yet.");
    await expect(drawer).toHaveTextContent("Bookmarks 0");
  },
};

let postGate = deferred();
const posts = { count: 0 };

export const AFastDoubleClickSavesOneBookmark: Story = {
  beforeEach({ msw }) {
    postGate = deferred();
    posts.count = 0;
    msw.use(
      http.post("/api/bookmarks", async () => {
        posts.count += 1;
        await postGate.promise;
        return HttpResponse.json(
          aWireBookmark({ id: 100, position: SAVED_CFI, title: "Prologue" }),
        );
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });
    const add = within(drawer).getByRole("button", { name: "+ Bookmark" });

    await userEvent.dblClick(add);

    await waitFor(() => expect(posts.count).toBe(1));
    await expect(add).toBeDisabled();

    postGate.release();

    await within(drawer).findByText("Prologue");
    await waitFor(() => expect(add).toBeEnabled());
    await expect(posts.count).toBe(1);
  },
};

export const TheDrawerSaysSoWhenTheBookmarksFailToLoad: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/bookmarks/book/:uuid", 500));
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await expect(within(drawer).getByRole("alert")).toHaveTextContent(
      "Your bookmarks couldn’t be loaded.",
    );
    await expect(drawer).not.toHaveTextContent("No bookmarks yet.");
    await expect(
      within(drawer).getByRole("button", { name: "+ Bookmark" }),
    ).toBeDisabled();
  },
};

export const ABookmarkFromAnotherFormatCannotBeJumpedTo: Story = {
  beforeEach() {
    r.annotations.bookmarks = [
      aWireBookmark({ id: 1, position: "pdf-page:3", title: "PDF page" }),
      aWireBookmark({
        id: 2,
        position: "epubcfi(/6/8!/4/2/1:0)",
        title: "Here",
      }),
    ];
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await expect(
      await within(drawer).findByRole("button", { name: /PDF page/ }),
    ).toBeDisabled();
    await expect(
      within(drawer).getByRole("button", { name: /Here/ }),
    ).toBeEnabled();
  },
};

export const ARowJumpsToItsPlaceAndClosesTheDrawer: Story = {
  beforeEach() {
    r.annotations.bookmarks = BOOKMARKS();
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await userEvent.click(
      await within(drawer).findByRole("button", { name: /Prologue/ }),
    );

    await expect(r.glue.argsOf("display")).toEqual([
      ["epubcfi(/6/4!/4/2/1:0)"],
    ]);
    await waitFor(() =>
      expect(canvas.queryByTestId("reader-bookmarks-drawer")).toBeNull(),
    );
  },
};

export const DeletingARowRemovesIt: Story = {
  beforeEach() {
    r.annotations.bookmarks = BOOKMARKS();
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });
    await userEvent.click(await firstDelete(drawer));

    await waitFor(() =>
      expect(within(drawer).getAllByTestId("reader-bookmark-row")).toHaveLength(
        1,
      ),
    );
    await expect(r.annotationWrites).toEqual([
      { method: "DELETE", path: "/api/bookmarks/1", body: undefined },
    ]);
    await expect(drawer).toHaveTextContent("Bookmarks 1");
  },
};

const deletes: string[] = [];

export const ARefusedDeleteKeepsTheRow: Story = {
  beforeEach({ msw }) {
    r.annotations.bookmarks = BOOKMARKS();
    deletes.length = 0;
    // Row 1 is refused and row 2 goes through.
    msw.use(
      http.delete("/api/bookmarks/:id", ({ params }) => {
        deletes.push(String(params.id));
        return params.id === "1"
          ? new HttpResponse("failed", { status: 500 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });
    await userEvent.click(await firstDelete(drawer));
    await waitFor(() => expect(deletes).toEqual(["1"]));

    // Row 2's delete is answered after row 1's refusal, so once its row is gone the refusal has been handled.
    const [, second] = within(drawer).getAllByRole("button", {
      name: "Delete bookmark",
    });
    await userEvent.click(second as HTMLElement);

    await waitFor(() =>
      expect(within(drawer).getAllByTestId("reader-bookmark-row")).toHaveLength(
        1,
      ),
    );
    await expect(
      within(drawer).getByTestId("reader-bookmark-row"),
    ).toHaveTextContent("Prologue");
  },
};

export const TheSheetIsEmptyBeforeAnyAnnotation: Story = {
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet({ canvas, userEvent });

    await expect(sheet).toHaveTextContent(
      "Nothing here yet. Highlight a passage or tap + Bookmark to save your place.",
    );
    await expect(sheet).toHaveTextContent("0 highlights · 0 bookmarks");
  },
};

export const TheSheetSaysSoWhenTheBookmarksFailToLoad: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/bookmarks/book/:uuid", 500));
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet({ canvas, userEvent });

    await expect(within(sheet).getByRole("alert")).toHaveTextContent(
      "Your annotations couldn’t be loaded.",
    );
    await expect(sheet).not.toHaveTextContent("Nothing here yet.");
  },
};

export const TheSheetListsHighlightsAndBookmarksTogether: Story = {
  beforeEach() {
    r.annotations.highlights = HIGHLIGHTS();
    r.annotations.bookmarks = BOOKMARKS().slice(0, 1);
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet({ canvas, userEvent });
    const inSheet = within(sheet);

    await inSheet.findByText("“The amber passage”");
    await expect(sheet).toHaveTextContent("2 highlights · 1 bookmark");
    await expect(
      inSheet.getAllByTestId("annotations-bookmark-row"),
    ).toHaveLength(1);
    await expect(inSheet.getAllByTestId("reader-highlight-row")).toHaveLength(
      2,
    );

    await userEvent.click(inSheet.getByTestId("annotations-filter-bookmarks"));

    await expect(inSheet.queryByTestId("reader-highlight-row")).toBeNull();
    await expect(
      inSheet.getAllByTestId("annotations-bookmark-row"),
    ).toHaveLength(1);

    await userEvent.click(
      inSheet.getByRole("button", { name: "Filter green" }),
    );

    await expect(inSheet.queryByTestId("annotations-bookmark-row")).toBeNull();
    await expect(inSheet.getAllByTestId("reader-highlight-row")).toHaveLength(
      1,
    );
    await expect(sheet).toHaveTextContent("The green passage");

    await userEvent.click(inSheet.getByRole("button", { name: "All" }));

    await expect(inSheet.getAllByTestId("reader-highlight-row")).toHaveLength(
      2,
    );
  },
};

export const TheSheetSavesTheCurrentPlace: Story = {
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet({ canvas, userEvent });

    await userEvent.click(
      within(sheet).getByRole("button", { name: "+ Bookmark" }),
    );

    await expect(
      await within(sheet).findByTestId("annotations-bookmark-row"),
    ).toHaveTextContent("Prologue");
    await expect(r.annotationWrites).toEqual([
      {
        method: "POST",
        path: "/api/bookmarks",
        body: { book_uuid: UUID, position: SAVED_CFI, title: "Prologue" },
      },
    ]);
  },
};

export const ARowInTheSheetJumpsAndClosesIt: Story = {
  beforeEach() {
    r.annotations.bookmarks = BOOKMARKS();
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet({ canvas, userEvent });

    await userEvent.click(
      await within(sheet).findByRole("button", { name: /Prologue/ }),
    );

    await expect(r.glue.argsOf("display")).toEqual([
      ["epubcfi(/6/4!/4/2/1:0)"],
    ]);
    await waitFor(() =>
      expect(canvas.queryByTestId("reader-annotations-drawer")).toBeNull(),
    );
  },
};

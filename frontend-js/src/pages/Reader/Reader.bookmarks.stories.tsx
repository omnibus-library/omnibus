import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { failing } from "../../testing/handlers";
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

const calls = (method: string) =>
  r.glue.calls.filter((c) => c.method === method).map((c) => c.args);

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

export const ARowJumpsToItsPlaceAndClosesTheDrawer: Story = {
  beforeEach() {
    r.annotations.bookmarks = BOOKMARKS();
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await userEvent.click(
      await within(drawer).findByRole("button", { name: /Prologue/ }),
    );

    await expect(calls("display")).toEqual([["epubcfi(/6/4!/4/2/1:0)"]]);
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

export const ARefusedDeleteKeepsTheRow: Story = {
  beforeEach({ msw }) {
    r.annotations.bookmarks = BOOKMARKS();
    msw.use(failing("delete", "/api/bookmarks/:id", 500));
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });
    await userEvent.click(await firstDelete(drawer));

    await expect(
      within(drawer).getAllByTestId("reader-bookmark-row"),
    ).toHaveLength(2);
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

    await expect(calls("display")).toEqual([["epubcfi(/6/4!/4/2/1:0)"]]);
    await waitFor(() =>
      expect(canvas.queryByTestId("reader-annotations-drawer")).toBeNull(),
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { pdfFixture, PDF_UUID as UUID } from "../../testing/readerFixtures";
import { aWireBookmark, aWireHighlight } from "../../testing/wire";
import { PdfReader } from "./PdfReader";

const pdf = pdfFixture();

const PASSAGE = "It was the beginning of everything that followed.";
const QUAD = [72, 710.5, 172, 710.5, 72, 700, 172, 700];
const ANCHOR = "pdf:2:72.0,710.5,172.0,710.5,72.0,700.0,172.0,700.0";
const SELECTED = JSON.stringify({
  page: 2,
  quads: [QUAD],
  text: PASSAGE,
  rect: { x: 300, y: 200, width: 120 },
});

const meta = {
  title: "Pages/PdfReader/Annotations",
  component: PdfReader,
  parameters: { path: `/pdf/${UUID}` },
  beforeEach: ({ msw }) => pdf.setup(msw),
  render: () => (
    <Routes>
      <Route path="/pdf/:uuid" element={<PdfReader />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  ),
} satisfies Meta<typeof PdfReader>;

export default meta;
type Story = StoryObj<typeof meta>;

type Args = Pick<
  Parameters<NonNullable<Story["play"]>>[0],
  "canvas" | "userEvent"
>;

/** Waits for the document to open, then reports the selection the way the glue does. */
async function select({ canvas }: Pick<Args, "canvas">) {
  await canvas.findByText("Page 3 of 5");
  window.__omnibusOnPdfSelection?.(SELECTED);
  return canvas.findByRole("button", { name: "Highlight green" });
}

async function openDrawer({ canvas, userEvent }: Args) {
  await canvas.findByText("Page 3 of 5");
  await userEvent.click(
    canvas.getByRole("button", { name: "Highlights and notes" }),
  );
  return canvas.findByTestId("reader-highlights-drawer");
}

/** Opens the bookmarks drawer once its list has loaded. */
async function openBookmarks({ canvas, userEvent }: Args) {
  await canvas.findByText("Page 3 of 5");
  await userEvent.click(canvas.getByRole("button", { name: "Bookmarks" }));
  const drawer = await canvas.findByTestId("reader-bookmarks-drawer");
  await waitFor(() => expect(within(drawer).queryByRole("status")).toBeNull());
  return drawer;
}

export const SavedHighlightsAreHandedToTheGlueToPaint: Story = {
  beforeEach() {
    pdf.annotations.highlights = [
      aWireHighlight({ id: 1, epub_cfi_range: ANCHOR, color: "green" }),
      aWireHighlight({ id: 2, epub_cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:5)" }),
      aWireHighlight({ id: 3, epub_cfi_range: null }),
      aWireHighlight({ id: 4, epub_cfi_range: "pdf:4", color: "rose" }),
    ];
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(pdf.glue.argsOf("paintHighlights").at(-1)).toEqual([
        [
          { anchor: ANCHOR, color: "green" },
          { anchor: "pdf:4", color: "rose" },
        ],
      ]),
    );
    // The badge counts every saved passage, painted or not.
    await expect(
      await within(
        canvas.getByRole("button", { name: "Highlights and notes" }),
      ).findByText("4"),
    ).toHaveClass("rd-badge");
  },
};

export const ASelectionShowsItsPopover: Story = {
  play: async ({ canvas }) => {
    await select({ canvas });

    for (const id of ["note", "copy", "quote", "share"]) {
      await expect(canvas.getByTestId(`selection-${id}`)).toBeVisible();
    }
  },
};

export const ASwatchSavesThePdfAnchorAndRepaints: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await select({ canvas }));

    await waitFor(() =>
      expect(pdf.annotationWrites).toEqual([
        {
          method: "POST",
          path: "/api/highlights",
          body: {
            book_uuid: UUID,
            epub_cfi_range: ANCHOR,
            color: "green",
            text: PASSAGE,
          },
        },
      ]),
    );
    await waitFor(() =>
      expect(pdf.glue.argsOf("paintHighlights").at(-1)).toEqual([
        [{ anchor: ANCHOR, color: "green" }],
      ]),
    );
    await expect(pdf.glue.argsOf("clearSelection")).toHaveLength(1);
    await expect(
      canvas.queryByRole("button", { name: "Highlight green" }),
    ).toBeNull();
  },
};

export const TheGlueClearingTheSelectionDismissesIt: Story = {
  play: async ({ canvas }) => {
    await select({ canvas });

    window.__omnibusOnPdfSelectionCleared?.("");

    await waitFor(() =>
      expect(canvas.queryByTestId("selection-note")).toBeNull(),
    );
  },
};

export const CopyAndShareHandTheTextToTheGlue: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });
    await userEvent.click(canvas.getByTestId("selection-copy"));
    await waitFor(() =>
      expect(pdf.glue.argsOf("copyText")).toEqual([[PASSAGE]]),
    );

    await select({ canvas });
    await userEvent.click(canvas.getByTestId("selection-share"));
    await waitFor(() =>
      expect(pdf.glue.argsOf("shareText")).toEqual([[PASSAGE]]),
    );
  },
};

export const QuoteOpensTheQuotePanel: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.click(canvas.getByTestId("selection-quote"));

    const panel = await canvas.findByTestId("reader-quote-drawer");
    await expect(panel).toHaveTextContent(PASSAGE);
    await expect(panel).toHaveTextContent("Aurora Station, Vol. 1");
  },
};

export const NoteOpensTheComposerAndSavesTheNote: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.click(canvas.getByTestId("selection-note"));
    await userEvent.type(
      await canvas.findByTestId("reader-note-input"),
      "ask Ada",
    );
    // Arrow keys belong to the text field, not the page.
    await userEvent.keyboard("{ArrowRight}{ArrowLeft}");
    await userEvent.click(canvas.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(pdf.annotationWrites.at(-1)).toEqual({
        method: "PATCH",
        path: "/api/highlights/100/note",
        body: { note: "ask Ada" },
      }),
    );
    await expect(canvas.getByText("Page 3 of 5")).toBeInTheDocument();
  },
};

export const TappingAKnownHighlightOpensTheDrawer: Story = {
  beforeEach() {
    pdf.annotations.highlights = [aWireHighlight({ epub_cfi_range: ANCHOR })];
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Page 3 of 5");
    await within(
      canvas.getByRole("button", { name: "Highlights and notes" }),
    ).findByText("1");

    window.__omnibusOnPdfHighlightTap?.("pdf:9:0,0,1,0,0,1,1,1");
    // A hook that does work, so the unknown tap has been handled before the drawer is checked.
    window.__omnibusOnPdfSelection?.(SELECTED);
    await canvas.findByTestId("selection-note");
    await expect(canvas.queryByTestId("reader-highlights-drawer")).toBeNull();

    window.__omnibusOnPdfHighlightTap?.(ANCHOR);
    await expect(
      await canvas.findByTestId("reader-highlights-drawer"),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Highlights and notes" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const ADrawerRowJumpsToItsPage: Story = {
  beforeEach() {
    pdf.annotations.highlights = [
      aWireHighlight({
        epub_cfi_range: "pdf:4:1,2,3,4,5,6,7,8",
        text: "Far on",
      }),
    ];
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await userEvent.click(await within(drawer).findByText("“Far on”"));

    await expect(pdf.glue.argsOf("goTo")).toEqual([[4]]);
    await canvas.findByText("Page 5 of 5");
    await waitFor(() =>
      expect(canvas.queryByTestId("reader-highlights-drawer")).toBeNull(),
    );
  },
};

export const DeletingAHighlightRemovesItAndRepaints: Story = {
  beforeEach() {
    pdf.annotations.highlights = [
      aWireHighlight({ id: 1, epub_cfi_range: ANCHOR, text: "First" }),
      aWireHighlight({
        id: 2,
        epub_cfi_range: "pdf:4",
        color: "rose",
        text: "Second",
      }),
    ];
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });
    const [first] = await within(drawer).findAllByTestId("highlight-delete");

    await userEvent.click(first as HTMLElement);

    await waitFor(() =>
      expect(pdf.annotationWrites).toEqual([
        { method: "DELETE", path: "/api/highlights/1", body: undefined },
      ]),
    );
    await waitFor(() =>
      expect(pdf.glue.argsOf("paintHighlights").at(-1)).toEqual([
        [{ anchor: "pdf:4", color: "rose" }],
      ]),
    );
    await expect(within(drawer).queryByText("“First”")).toBeNull();
  },
};

export const BookmarksSaveTheCurrentPageTitledByItsNumber: Story = {
  play: async ({ canvas, userEvent }) => {
    const drawer = await openBookmarks({ canvas, userEvent });

    await userEvent.click(
      within(drawer).getByRole("button", { name: "+ Bookmark" }),
    );

    await expect(await within(drawer).findByText("Page 3")).toHaveClass(
      "rd-bm-label",
    );
    await expect(pdf.annotationWrites).toEqual([
      {
        method: "POST",
        path: "/api/bookmarks",
        body: { book_uuid: UUID, position: "pdf-page:2", title: "Page 3" },
      },
    ]);
  },
};

export const ABookmarkRowJumpsToItsPage: Story = {
  beforeEach() {
    pdf.annotations.bookmarks = [
      aWireBookmark({ position: "pdf-page:4", title: "Page 5" }),
    ];
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openBookmarks({ canvas, userEvent });

    await userEvent.click(
      await within(drawer).findByRole("button", { name: /Page 5/ }),
    );

    await expect(pdf.glue.argsOf("goTo")).toEqual([[4]]);
    await canvas.findByText("Page 5 of 5");
  },
};

export const DeletingABookmarkRemovesItsRow: Story = {
  beforeEach() {
    pdf.annotations.bookmarks = [
      aWireBookmark({ id: 7, position: "pdf-page:4", title: "Page 5" }),
    ];
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openBookmarks({ canvas, userEvent });

    await userEvent.click(
      await within(drawer).findByRole("button", { name: "Delete bookmark" }),
    );

    await waitFor(() =>
      expect(within(drawer).queryByTestId("reader-bookmark-row")).toBeNull(),
    );
    await expect(pdf.annotationWrites).toEqual([
      { method: "DELETE", path: "/api/bookmarks/7", body: undefined },
    ]);
  },
};

export const OpeningOneToolClosesTheOther: Story = {
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });
    const highlights = canvas.getByRole("button", {
      name: "Highlights and notes",
    });
    await expect(highlights).toHaveAttribute("aria-pressed", "true");

    // The drawer's scrim covers the toolbar, so Escape is the way back to it.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Bookmarks" }));

    await expect(
      await canvas.findByTestId("reader-bookmarks-drawer"),
    ).toBeVisible();
    await expect(canvas.queryByTestId("reader-highlights-drawer")).toBeNull();
    await expect(highlights).toHaveAttribute("aria-pressed", "false");
  },
};

export const EscapeClosesTheSelectionThenTheDrawer: Story = {
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });
    window.__omnibusOnPdfSelection?.(SELECTED);
    await canvas.findByTestId("selection-note");

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(canvas.queryByTestId("selection-note")).toBeNull(),
    );
    await expect(canvas.getByTestId("reader-highlights-drawer")).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-highlights-drawer")).toBeNull(),
    );
  },
};

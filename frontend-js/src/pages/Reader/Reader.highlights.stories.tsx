import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { failing } from "../../testing/handlers";
import { readerFixture, UUID } from "../../testing/readerStory";
import { aWireHighlight } from "../../testing/wire";
import { Reader } from "./Reader";

const r = readerFixture();

const RANGE = "epubcfi(/6/8!/4/2,/1:10,/1:60)";
const PASSAGE = "It was the beginning of everything that followed.";
const SELECTED = JSON.stringify({
  cfiRange: RANGE,
  text: PASSAGE,
  rect: { x: 300, y: 200, width: 120 },
});

const meta = {
  title: "Pages/Reader/Highlights",
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

type Canvas = Parameters<NonNullable<Story["play"]>>[0]["canvas"];

const refused = { count: 0 };

/** The count badge on the tool that opens the highlights. */
const badge = (canvas: Canvas) =>
  within(canvas.getByRole("button", { name: "Highlights and notes" }));

const calls = (method: string) =>
  r.glue.calls.filter((c) => c.method === method).map((c) => c.args);

/** Waits for the book, then selects `PASSAGE` the way the glue reports it. */
async function select({
  canvas,
}: Pick<Parameters<NonNullable<Story["play"]>>[0], "canvas">) {
  await canvas.findByTestId("reader-header-chapter");
  window.__omnibusOnSelection?.(SELECTED);
  return canvas.findByRole("button", { name: "Highlight green" });
}

export const PaintsSavedHighlightsOnOpen: Story = {
  beforeEach() {
    r.annotations.highlights = [
      aWireHighlight({
        id: 1,
        epub_cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
        color: "amber",
      }),
      aWireHighlight({
        id: 2,
        epub_cfi_range: "epubcfi(/6/6!/4/2,/1:0,/1:9)",
        color: "green",
      }),
      aWireHighlight({ id: 3, epub_cfi_range: "pdf:2:1,2,3,4,5,6,7,8" }),
      aWireHighlight({ id: 4, epub_cfi_range: null }),
    ];
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(calls("addAnnotation")).toHaveLength(2));

    await expect(calls("addAnnotation")).toEqual([
      ["epubcfi(/6/4!/4/2,/1:0,/1:5)", "amber"],
      ["epubcfi(/6/6!/4/2,/1:0,/1:9)", "green"],
    ]);
    // The badge counts every saved passage, painted or not.
    await expect(await badge(canvas).findByText("4")).toHaveClass("rd-badge");
  },
};

export const SelectionShowsItsPopover: Story = {
  play: async ({ canvas, canvasElement }) => {
    await select({ canvas });

    for (const name of ["amber", "green", "blue", "rose", "violet"]) {
      await expect(
        canvas.getByRole("button", { name: `Highlight ${name}` }),
      ).toBeVisible();
    }
    for (const id of ["note", "copy", "quote", "share"]) {
      await expect(canvas.getByTestId(`selection-${id}`)).toBeVisible();
    }
    // Anchored just above the selection, kept clear of the left edge.
    await expect(
      canvasElement.querySelector(".rd-selection-popover"),
    ).toHaveStyle({
      top: "148px",
      left: "210px",
    });
  },
};

export const ASwatchPaintsAndSavesTheHighlight: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await select({ canvas }));

    await expect(calls("addAnnotation")).toEqual([[RANGE, "green"]]);
    await waitFor(() =>
      expect(r.annotationWrites).toEqual([
        {
          method: "POST",
          path: "/api/highlights",
          body: {
            book_uuid: UUID,
            epub_cfi_range: RANGE,
            color: "green",
            text: PASSAGE,
          },
        },
      ]),
    );
    await expect(await badge(canvas).findByText("1")).toHaveClass("rd-badge");
    await expect(
      canvas.queryByRole("button", { name: "Highlight green" }),
    ).toBeNull();
  },
};

export const AFailedSaveUnpaints: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/highlights", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await select({ canvas }));

    await waitFor(() => expect(calls("removeAnnotation")).toEqual([[RANGE]]));
    await expect(calls("addAnnotation")).toEqual([[RANGE, "green"]]);
    await expect(badge(canvas).queryByText("1")).toBeNull();
  },
};

export const NoteOpensTheComposerAndSavesTheNote: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.click(canvas.getByTestId("selection-note"));

    const composer = await canvas.findByTestId("reader-note-composer");
    await expect(composer).toHaveTextContent(`“${PASSAGE}”`);
    await expect(r.annotationWrites[0]).toMatchObject({
      body: { color: "amber" },
    });

    await userEvent.type(
      canvas.getByTestId("reader-note-input"),
      "  <b>mind</b> this ",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-note-composer")).toBeNull(),
    );
    await expect(r.annotationWrites.at(-1)).toEqual({
      method: "PATCH",
      path: "/api/highlights/100/note",
      body: { note: "<b>mind</b> this" },
    });
  },
};

export const ACancelledNoteKeepsTheHighlight: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });
    await userEvent.click(canvas.getByTestId("selection-note"));
    await canvas.findByTestId("reader-note-composer");

    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-note-composer")).toBeNull(),
    );
    await expect(r.annotationWrites).toHaveLength(1);
    await expect(await badge(canvas).findByText("1")).toHaveClass("rd-badge");
  },
};

export const AFailedNoteSaveKeepsTheComposerOpen: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.patch("/api/highlights/:id/note", () => {
        refused.count += 1;
        return new HttpResponse("failed", { status: 500 });
      }),
    );
    refused.count = 0;
  },
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });
    await userEvent.click(canvas.getByTestId("selection-note"));
    await userEvent.type(
      await canvas.findByTestId("reader-note-input"),
      "a thought",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(refused.count).toBe(1));
    await expect(canvas.getByTestId("reader-note-composer")).toBeVisible();
    await expect(canvas.getByTestId("reader-note-input")).toHaveValue(
      "a thought",
    );
  },
};

export const QuoteOpensTheQuotePanel: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.click(canvas.getByTestId("selection-quote"));

    const panel = await canvas.findByTestId("reader-quote-drawer");
    await expect(panel).toHaveTextContent(PASSAGE);
    await expect(panel).toHaveTextContent("Sora Inkwell");
    await expect(panel).toHaveTextContent("Aurora Station, Vol. 1");
  },
};

export const CopyHandsTheTextToTheGlue: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.click(canvas.getByTestId("selection-copy"));

    await waitFor(() => expect(calls("copyText")).toEqual([[PASSAGE]]));
    await expect(canvas.queryByTestId("selection-copy")).toBeNull();
    await expect(r.annotationWrites).toEqual([]);
  },
};

export const ShareHandsTheTextToTheGlue: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.click(canvas.getByTestId("selection-share"));

    await waitFor(() => expect(calls("shareText")).toEqual([[PASSAGE]]));
    await expect(canvas.queryByTestId("selection-share")).toBeNull();
  },
};

export const TheGlueClearingTheSelectionDismissesIt: Story = {
  play: async ({ canvas }) => {
    await select({ canvas });

    window.__omnibusOnSelectionCleared?.("");

    await waitFor(() =>
      expect(canvas.queryByTestId("selection-note")).toBeNull(),
    );
  },
};

export const ADroppedSelectionPayloadShowsNothing: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    window.__omnibusOnSelection?.("not json");
    window.__omnibusOnSelection?.(JSON.stringify({ text: "no range or rect" }));

    await expect(canvas.queryByTestId("selection-note")).toBeNull();
  },
};

export const EscapeDismissesTheSelectionBeforeLeaving: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(canvas.queryByTestId("selection-note")).toBeNull(),
    );
    await expect(canvas.queryByText("Book page")).toBeNull();
  },
};

export const TurningThePageDismissesTheSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    await select({ canvas });

    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(canvas.queryByTestId("selection-note")).toBeNull(),
    );
  },
};

const AMBER_RANGE = "epubcfi(/6/4!/4/2,/1:0,/1:5)";
const GREEN_RANGE = "epubcfi(/6/6!/4/2,/1:0,/1:9)";

/** Three passages: an amber one with a note, a green one, and a blue Kobo one with no anchor. */
const SAVED_PASSAGES = () => [
  aWireHighlight({
    id: 1,
    epub_cfi_range: AMBER_RANGE,
    color: "amber",
    text: "The first passage",
    note: "<i>remember</i> this",
  }),
  aWireHighlight({
    id: 2,
    epub_cfi_range: GREEN_RANGE,
    color: "green",
    text: "The second passage",
  }),
  aWireHighlight({
    id: 3,
    epub_cfi_range: null,
    color: "blue",
    text: "The Kobo passage",
  }),
];

/** Waits for the book and its saved passages, then opens the highlights drawer. */
async function openDrawer({
  canvas,
  userEvent,
}: Pick<Parameters<NonNullable<Story["play"]>>[0], "canvas" | "userEvent">) {
  await canvas.findByTestId("reader-header-chapter");
  await userEvent.click(
    canvas.getByRole("button", { name: "Highlights and notes" }),
  );
  const drawer = await canvas.findByTestId("reader-highlights-drawer");
  // The passages arrive after the book opens; a row read before they do is not there yet.
  if (r.annotations.highlights.length > 0) {
    await within(drawer).findAllByTestId("reader-highlight-row");
  }
  return drawer;
}

const rowOf = (canvas: Canvas, text: string) => {
  const row = canvas.getByText(`“${text}”`).closest(".rd-hl-row");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${text}`);
  return within(row);
};

export const TheDrawerIsEmptyBeforeAnyHighlight: Story = {
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await expect(drawer).toHaveTextContent("No highlights yet.");
    await expect(drawer).toHaveTextContent("Highlights & notes 0");
  },
};

export const TheDrawerListsEveryPassage: Story = {
  beforeEach() {
    r.annotations.highlights = SAVED_PASSAGES();
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await expect(
      within(drawer).getAllByTestId("reader-highlight-row"),
    ).toHaveLength(3);
    await expect(drawer).toHaveTextContent("Highlights & notes 3");
    await expect(
      within(drawer).getByRole("button", { name: "All 3" }),
    ).toHaveAttribute("aria-pressed", "true");
    // A note is text: its tags are shown, not parsed.
    await expect(within(drawer).getByText("<i>remember</i> this")).toHaveClass(
      "rd-hl-note",
    );
    await expect(
      within(rowOf(canvas, "The first passage").getByTestId("highlight-note"))
        .getByText,
    ).toBeDefined();
    await expect(
      rowOf(canvas, "The first passage").getByTestId("highlight-note"),
    ).toHaveTextContent("Edit note");
    await expect(
      rowOf(canvas, "The second passage").getByTestId("highlight-note"),
    ).toHaveTextContent("Add note");
  },
};

export const AColorChipFiltersTheList: Story = {
  beforeEach() {
    r.annotations.highlights = SAVED_PASSAGES();
  },
  play: async ({ canvas, userEvent }) => {
    const drawer = await openDrawer({ canvas, userEvent });

    await userEvent.click(
      within(drawer).getByRole("button", { name: "Filter green" }),
    );

    await expect(
      within(drawer).getAllByTestId("reader-highlight-row"),
    ).toHaveLength(1);
    await expect(drawer).toHaveTextContent("The second passage");
    await expect(
      within(drawer).getByRole("button", { name: "Filter green" }),
    ).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(
      within(drawer).getByRole("button", { name: "Filter rose" }),
    );

    await expect(drawer).toHaveTextContent("No highlights yet.");
  },
};

export const ARecolorRepaintsThePassage: Story = {
  beforeEach() {
    r.annotations.highlights = SAVED_PASSAGES();
  },
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });
    const row = rowOf(canvas, "The second passage");

    await userEvent.click(row.getByRole("button", { name: "Recolor blue" }));

    await waitFor(() =>
      expect(row.getByRole("button", { name: "Recolor blue" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await expect(r.annotationWrites).toEqual([
      {
        method: "PATCH",
        path: "/api/highlights/2/color",
        body: { color: "blue" },
      },
    ]);
    await expect(calls("removeAnnotation")).toEqual([[GREEN_RANGE]]);
    await expect(calls("addAnnotation").at(-1)).toEqual([GREEN_RANGE, "blue"]);
    // The anchorless row recolors too, with nothing painted to change.
    await userEvent.click(
      rowOf(canvas, "The Kobo passage").getByRole("button", {
        name: "Recolor rose",
      }),
    );
    await waitFor(() => expect(r.annotationWrites).toHaveLength(2));
    await expect(calls("removeAnnotation")).toHaveLength(1);
  },
};

export const ARefusedRecolorLeavesThePassageAsItWas: Story = {
  beforeEach({ msw }) {
    r.annotations.highlights = SAVED_PASSAGES();
    refused.count = 0;
    msw.use(
      http.patch("/api/highlights/:id/color", () => {
        refused.count += 1;
        return new HttpResponse("failed", { status: 500 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });
    const row = rowOf(canvas, "The second passage");
    const painted = calls("addAnnotation").length;

    await userEvent.click(row.getByRole("button", { name: "Recolor blue" }));

    await waitFor(() => expect(refused.count).toBe(1));
    await expect(
      row.getByRole("button", { name: "Recolor green" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(calls("removeAnnotation")).toEqual([]);
    await expect(calls("addAnnotation")).toHaveLength(painted);
  },
};

export const ARowJumpsToItsPassageAndClosesTheDrawer: Story = {
  beforeEach() {
    r.annotations.highlights = SAVED_PASSAGES();
  },
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });
    await expect(canvas.getByText("“The Kobo passage”")).toBeDisabled();

    await userEvent.click(canvas.getByText("“The second passage”"));

    await waitFor(() => expect(calls("display")).toEqual([[GREEN_RANGE]]));
    await waitFor(() =>
      expect(canvas.queryByTestId("reader-highlights-drawer")).toBeNull(),
    );
  },
};

export const AddAndEditNoteOpenTheComposer: Story = {
  beforeEach() {
    r.annotations.highlights = SAVED_PASSAGES();
  },
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });

    await userEvent.click(
      rowOf(canvas, "The first passage").getByTestId("highlight-note"),
    );

    await expect(await canvas.findByTestId("reader-note-input")).toHaveValue(
      "<i>remember</i> this",
    );
    await expect(canvas.queryByTestId("reader-highlights-drawer")).toBeNull();

    await userEvent.clear(canvas.getByTestId("reader-note-input"));
    await userEvent.click(canvas.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(canvas.queryByTestId("reader-note-composer")).toBeNull(),
    );
    // A blank note removes it.
    await expect(r.annotationWrites).toEqual([
      { method: "PATCH", path: "/api/highlights/1/note", body: { note: null } },
    ]);
  },
};

export const QuoteAndCopyActOnTheRow: Story = {
  beforeEach() {
    r.annotations.highlights = [
      ...SAVED_PASSAGES(),
      aWireHighlight({ id: 4, text: null }),
    ];
  },
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });
    const row = rowOf(canvas, "The second passage");

    await userEvent.click(row.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(calls("copyText")).toEqual([["The second passage"]]),
    );
    await expect(
      rowOf(canvas, "(highlighted passage)").getByRole("button", {
        name: "Copy",
      }),
    ).toBeDisabled();

    await userEvent.click(row.getByTestId("highlight-quote"));

    await expect(
      await canvas.findByTestId("reader-quote-drawer"),
    ).toHaveTextContent("The second passage");
    await expect(canvas.queryByTestId("reader-highlights-drawer")).toBeNull();
  },
};

export const DeletingARemovesItEverywhere: Story = {
  beforeEach() {
    r.annotations.highlights = SAVED_PASSAGES();
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await openDrawer({ canvas, userEvent });

    await userEvent.click(
      rowOf(canvas, "The second passage").getByTestId("highlight-delete"),
    );

    await waitFor(() =>
      expect(canvas.queryByText("“The second passage”")).toBeNull(),
    );
    await expect(r.annotationWrites).toEqual([
      { method: "DELETE", path: "/api/highlights/2", body: undefined },
    ]);
    await expect(calls("removeAnnotation")).toEqual([[GREEN_RANGE]]);
    await expect(badge(canvas).getByText("2")).toHaveClass("rd-badge");
    // The button that had focus is gone; Escape still has to be heard.
    await waitFor(() =>
      expect(canvasElement.querySelector(".rd-surface")).toHaveFocus(),
    );
  },
};

export const ARefusedDeleteKeepsThePassage: Story = {
  beforeEach({ msw }) {
    r.annotations.highlights = SAVED_PASSAGES();
    refused.count = 0;
    msw.use(
      http.delete("/api/highlights/:id", () => {
        refused.count += 1;
        return new HttpResponse("failed", { status: 500 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await openDrawer({ canvas, userEvent });

    await userEvent.click(
      rowOf(canvas, "The second passage").getByTestId("highlight-delete"),
    );

    await waitFor(() => expect(refused.count).toBe(1));
    await expect(canvas.getByText("“The second passage”")).toBeVisible();
    await expect(calls("removeAnnotation")).toEqual([]);
  },
};

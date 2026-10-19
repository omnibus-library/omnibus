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

const refused = { count: 0 };

/** The count badge on the tool that opens the highlights. */
const badge = (canvas: ReturnType<typeof within>) =>
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

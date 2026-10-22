import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, spyOn, waitFor, within } from "storybook/test";
import { coverUrl, type MetadataOverrides, toEditableBook } from "../../api";
import {
  type EbookMetadata,
  MetadataOverrides as MetadataOverridesBody,
} from "../../api/generated/schemas";
import { storyClient } from "../../testing/AppHarness";
import { bookDetailHandlers, deferred, failing } from "../../testing/handlers";
import {
  anEditableWireBook,
  coverWriteHandlers,
  overridesHandlers,
  providersHandler,
} from "../../testing/metadataHandlers";
import { PREVIEW } from "../../testing/uploadHandlers";
import { BookDetail } from "../BookDetail/BookDetail";
import { BookEdit } from "./BookEdit";

const BOOK = anEditableWireBook();
const OVERRIDDEN = anEditableWireBook({
  has_override: true,
  has_cover_override: true,
});
const UUID = BOOK.unique_identifier;
const DIALOG = "Edit Aurora Station, Vol. 1";

const saved: MetadataOverrides[] = [];
const reverted = { count: 0 };
const uploaded: string[] = [];
const FETCHED: string[] = [];
const bookReads = { count: 0 };

// Real PNG bytes: a held preview that fails to decode drops its <img>.
const PNG = Uint8Array.from(
  atob(PREVIEW.slice(PREVIEW.indexOf(",") + 1)),
  (c) => c.charCodeAt(0),
);
const PICK = () => new File([PNG], "new-cover.png", { type: "image/png" });

let router: ReturnType<typeof createMemoryRouter>;

// The editor is the `edit` child of the book page, as under the app router; its leave guard needs a data router, which the stories' own harness doesn't provide.
function EditRoutes({ entries }: { entries: string[] }) {
  const [made] = useState(() => {
    router = createMemoryRouter(
      [
        { path: "/", element: <p>Library</p> },
        {
          path: "/books/:uuid",
          element: <BookDetail />,
          children: [{ path: "edit", element: <BookEdit /> }],
        },
      ],
      { initialEntries: entries, initialIndex: entries.length - 1 },
    );
    return router;
  });
  return <RouterProvider router={made} />;
}

const meta = {
  title: "Pages/BookEdit",
  component: EditRoutes,
  args: { entries: [`/books/${UUID}/edit`] },
  parameters: { ownRouter: true },
  beforeEach({ msw }) {
    saved.length = 0;
    uploaded.length = 0;
    FETCHED.length = 0;
    bookReads.count = 0;
    reverted.count = 0;
    msw.use(
      ...overridesHandlers(BOOK, { saved, reverted }),
      ...coverWriteHandlers(BOOK, { uploaded }),
      providersHandler(false),
      ...bookDetailHandlers(BOOK),
    );
  },
} satisfies Meta<typeof EditRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page reads the book first and the editor second; this answers the editor's read with `second`. */
function afterTheFirstRead(second: () => Response | Promise<Response>) {
  let reads = 0;
  return http.get("/api/ebooks/:uuid", () =>
    ++reads === 1 ? HttpResponse.json(BOOK) : second(),
  );
}

const sheet = async (canvas: ReturnType<typeof within>) =>
  within(await canvas.findByRole("dialog", { name: DIALOG }));

/** The keys the sheet marked stale. */
function watchInvalidations() {
  const spy = spyOn(storyClient(), "invalidateQueries");
  return () =>
    spy.mock.calls.map(
      ([filters]) => (filters as { queryKey: unknown[] }).queryKey,
    );
}

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(
      afterTheFirstRead(async () => {
        await delay("infinite");
        return new HttpResponse(null);
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Opening the record"),
    ).toBeInTheDocument();
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(afterTheFirstRead(() => new HttpResponse(null, { status: 404 })));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Book not found."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/");
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(
      afterTheFirstRead(
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to book" }),
    ).toHaveAttribute("href", `/books/${UUID}`);
  },
};

export const OpensOverTheBookPage: Story = {
  args: { entries: [`/books/${UUID}`] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("tab", { name: "Files & Details" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));
    await userEvent.click(
      await canvas.findByRole("menuitem", { name: "Edit metadata" }),
    );

    const dialog = await sheet(canvas);
    await expect(dialog.getByLabelText(/^Title/)).toHaveValue(
      "Aurora Station, Vol. 1",
    );
    // The page stays drawn under the sheet, on the tab it was left on.
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("tab", { name: "Files & Details" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(router.state.location.pathname).toBe(`/books/${UUID}/edit`);
  },
};

export const DeepLinkOpensTheSheet: Story = {
  play: async ({ canvas }) => {
    const dialog = await sheet(canvas);
    await expect(dialog.getByTestId("es-title")).toHaveTextContent(
      "Aurora Station, Vol. 1",
    );
    await expect(dialog.getByTestId("es-author")).toHaveTextContent(
      "Sora Inkwell",
    );
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
  },
};

export const MergedUuidKeepsTheSheetOpen: Story = {
  args: { entries: ["/books/b7b0d4a0-0000-4000-8000-000000000000/edit"] },
  beforeEach({ msw }) {
    // Any other uuid reads as the surviving book.
    msw.use(http.get("/api/ebooks/:uuid", () => HttpResponse.json(BOOK)));
  },
  play: async ({ canvas }) => {
    await sheet(canvas);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/books/${UUID}/edit`),
    );
  },
};

export const TabsAreDetailsArtworkAndIdentifiers: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const dialog = await sheet(canvas);
    const tabs = dialog.getAllByRole("tab");
    await expect(tabs.map((t) => t.textContent)).toEqual([
      "Details",
      "Artwork",
      "Identifiers",
    ]);
    await expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // No Sorting tab, and no Sort by or Filename field.
    await expect(dialog.queryByLabelText(/^Sort by/)).toBeNull();
    await expect(dialog.queryByLabelText(/^Filename/)).toBeNull();

    await userEvent.click(tabs[1] as HTMLElement);

    await expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    // The panel fades in.
    await waitFor(() =>
      expect(dialog.getByRole("tabpanel", { name: "Artwork" })).toBeVisible(),
    );
    await expect(
      canvasElement.querySelector("#es-panel-details"),
    ).not.toBeVisible();

    // Arrow keys move between them, wrapping.
    tabs[1]?.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    await expect(tabs[2]).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  },
};

export const DetailsLabelsNumberInSeriesAndPrintPagesHasNoHint: Story = {
  play: async ({ canvas }) => {
    const dialog = await sheet(canvas);
    const panel = dialog.getByRole("tabpanel", { name: "Details" });
    const labels = [...panel.querySelectorAll(".me-label")].map(
      (label) => label.textContent,
    );

    await expect(labels).toEqual([
      "Title",
      "AuthorsPrimary author first",
      "Series",
      "Number in series",
      "Publisher",
      "Published",
      "Language",
      "Print pages",
      "ISBN-1313 digits",
      "ISBN-1010 characters",
      "DescriptionPlain text or HTML",
      "Tags",
      "Genres",
    ]);
  },
};

export const IdentifiersListsTheBooksIdentifiers: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/ebooks/:uuid", () =>
        HttpResponse.json(
          anEditableWireBook({
            identifiers: [
              { scheme: "ISBN", value: "9780134685991" },
              { scheme: null, value: "urn:uuid:817d56de" },
            ],
          }),
        ),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(dialog.getByRole("tab", { name: "Identifiers" }));

    const list = dialog.getByTestId("es-identifiers");
    await expect(
      [...list.querySelectorAll(":scope > div")].map((row) => [
        row.querySelector("dt")?.textContent,
        row.querySelector("dd")?.textContent,
      ]),
    ).toEqual([
      ["ISBN", "9780134685991"],
      ["Type unknown", "urn:uuid:817d56de"],
    ]);
  },
};

export const NoteSitsUnderTheSaveBar: Story = {
  play: async ({ canvas }) => {
    const dialog = await sheet(canvas);
    const note = dialog.getByText(
      "Omnibus never writes to your book files. Your edits are saved in the Omnibus library database.",
    );
    // The sheet rises into view.
    await waitFor(() => expect(note).toBeVisible());
    await expect(
      dialog.getByTestId("es-save-state").compareDocumentPosition(note),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  },
};

export const EditedFieldIsMarkedAndCounted: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "No changes",
    );
    await expect(dialog.getByTestId("es-discard")).toBeDisabled();

    await userEvent.type(await dialog.findByLabelText(/^Title/), "!");

    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "1 unsaved change",
    );
    await expect(dialog.getByText("• Edited")).toBeInTheDocument();
    await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "data-edited",
    );
    await expect(
      dialog.getByRole("tab", { name: "Artwork" }),
    ).not.toHaveAttribute("data-edited");
    // The sheet's title follows the form.
    await expect(dialog.getByTestId("es-title")).toHaveTextContent(
      "Aurora Station, Vol. 1!",
    );
  },
};

export const DoneSavesAndClosesWithAToast: Story = {
  beforeEach({ msw }) {
    let stored: EbookMetadata = BOOK;
    msw.use(
      http.get("/api/ebooks/:uuid", () => HttpResponse.json(stored)),
      http.post("/api/ebooks/:uuid/overrides", async ({ request }) => {
        const body = MetadataOverridesBody.parse(await request.json());
        saved.push(body);
        stored = { ...stored, title: body.title ?? stored.title };
        return HttpResponse.json(stored);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    const marked = watchInvalidations();
    await userEvent.clear(title);
    await userEvent.type(title, "Aurora Station");

    await userEvent.click(dialog.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(saved).toEqual([{ title: "Aurora Station" }]);
    await expect(
      await canvas.findByText("Saved 1 change to Aurora Station"),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Aurora Station" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/books/${UUID}`),
    );
    // The page, the lists and the resume row read what an edit changes.
    await expect(marked()).toEqual(
      expect.arrayContaining([
        ["book", UUID],
        ["books"],
        ["shelf-page"],
        ["shelves"],
        ["progress", "recent"],
      ]),
    );
  },
};

export const DoneWithoutChangesJustCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);

    await userEvent.click(dialog.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(saved).toEqual([]);
    await expect(canvas.queryByText(/^Saved /)).not.toBeInTheDocument();
    await expect(router.state.location.pathname).toBe(`/books/${UUID}`);
  },
};

export const SaveFails: Story = {
  beforeEach({ msw }) {
    msw.use(...overridesHandlers(BOOK, { refuse: "title is too long" }));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    await userEvent.type(title, "!");
    await userEvent.click(dialog.getByRole("button", { name: "Done" }));

    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "title is too long",
    );
    await expect(title).toHaveValue("Aurora Station, Vol. 1!");
    await expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled();
  },
};

export const CloseWithEditsAsksInline: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.type(await dialog.findByLabelText(/^Title/), "!");

    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    const leave = dialog.getByRole("group", {
      name: "Save your change before closing?",
    });
    await expect(leave).toBeVisible();
    await expect(
      within(leave).getByRole("button", { name: "Keep editing" }),
    ).toBeInTheDocument();
    await expect(
      within(leave).getByRole("button", { name: "Don’t save" }),
    ).toBeInTheDocument();
    await expect(
      within(leave).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
    // Still open: asking is not leaving.
    await expect(router.state.location.pathname).toBe(`/books/${UUID}/edit`);
  },
};

export const KeepEditingReturnsToTheForm: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    await userEvent.type(title, "!");
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    await userEvent.click(dialog.getByRole("button", { name: "Keep editing" }));

    await expect(dialog.queryByTestId("es-leave")).not.toBeInTheDocument();
    await expect(title).toHaveValue("Aurora Station, Vol. 1!");
    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "1 unsaved change",
    );
  },
};

export const DontSaveDiscardsAndCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.type(await dialog.findByLabelText(/^Title/), "!");
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    await userEvent.click(dialog.getByRole("button", { name: "Don’t save" }));

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(saved).toEqual([]);
    await expect(router.state.location.pathname).toBe(`/books/${UUID}`);
    await waitFor(() => expect(window.onbeforeunload).toBeNull());
  },
};

export const SaveFromTheLeaveBar: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    await userEvent.clear(title);
    await userEvent.type(title, "Aurora Station");
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    await userEvent.click(
      within(dialog.getByTestId("es-leave")).getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() => expect(saved).toEqual([{ title: "Aurora Station" }]));
    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(
      await canvas.findByText("Saved 1 change to Aurora Station"),
    ).toBeInTheDocument();
  },
};

export const SaveFailingFromTheLeaveBarSaysWhy: Story = {
  beforeEach({ msw }) {
    msw.use(...overridesHandlers(BOOK, { refuse: "title is too long" }));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.type(await dialog.findByLabelText(/^Title/), "!");
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    await userEvent.click(
      within(dialog.getByTestId("es-leave")).getByRole("button", {
        name: "Save",
      }),
    );

    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "title is too long",
    );
    // Still asking, still open.
    await expect(dialog.getByTestId("es-leave")).toBeVisible();
  },
};

export const EscapeWithEditsAsksInline: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.type(await dialog.findByLabelText(/^Title/), "!");

    await userEvent.keyboard("{Escape}");

    await expect(dialog.getByTestId("es-leave")).toBeVisible();
    await expect(router.state.location.pathname).toBe(`/books/${UUID}/edit`);
  },
};

export const EscapeWithoutEditsCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    await sheet(canvas);

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(router.state.location.pathname).toBe(`/books/${UUID}`);
  },
};

export const BackWithEditsAsksInline: Story = {
  args: { entries: [`/books/${UUID}`, `/books/${UUID}/edit`] },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.type(await dialog.findByLabelText(/^Title/), "!");

    await router.navigate(-1);

    await expect(await dialog.findByTestId("es-leave")).toBeVisible();
    await expect(router.state.location.pathname).toBe(`/books/${UUID}/edit`);
    await userEvent.click(dialog.getByRole("button", { name: "Keep editing" }));
    await expect(dialog.queryByTestId("es-leave")).not.toBeInTheDocument();

    await router.navigate(-1);
    await userEvent.click(
      await dialog.findByRole("button", { name: "Don’t save" }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/books/${UUID}`),
    );
    await expect(saved).toEqual([]);
  },
};

export const DiscardEditsResetsTheForm: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    await userEvent.type(title, "!");

    await userEvent.click(
      dialog.getByRole("button", { name: "Discard edits" }),
    );

    await expect(title).toHaveValue("Aurora Station, Vol. 1");
    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "No changes",
    );
    await expect(dialog.getByTestId("es-discard")).toBeDisabled();
    await expect(saved).toEqual([]);
  },
};

export const AddFocusesTheField: Story = {
  args: { entries: [`/books/${UUID}/edit?field=publisher`] },
  play: async ({ canvas }) => {
    const dialog = await sheet(canvas);

    await waitFor(() =>
      expect(dialog.getByLabelText(/^Publisher/)).toHaveFocus(),
    );
    await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

export const ClosingReturnsFocusToTheOpener: Story = {
  args: { entries: [`/books/${UUID}`] },
  play: async ({ canvas, userEvent }) => {
    const more = await canvas.findByRole("button", { name: "More actions" });
    await userEvent.click(more);
    await userEvent.click(
      await canvas.findByRole("menuitem", { name: "Edit metadata" }),
    );
    const dialog = await sheet(canvas);

    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    // The page opened the sheet, so closing goes back one step, to the book.
    await expect(router.state.location.pathname).toBe(`/books/${UUID}`);
    await waitFor(() => expect(more).toHaveFocus());
  },
};

export const Reverts: Story = {
  beforeEach({ msw }) {
    msw.use(http.get("/api/ebooks/:uuid", () => HttpResponse.json(OVERRIDDEN)));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const revert = await dialog.findByRole("button", {
      name: "Revert to scanned values",
    });
    const marked = watchInvalidations();

    await userEvent.click(revert);
    // Dropping every edit asks first.
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revert" }),
    );

    await waitFor(() => expect(reverted.count).toBe(1));
    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(
      await canvas.findByText("Reverted to scanned values"),
    ).toBeInTheDocument();
    await expect(marked()).toEqual(
      expect.arrayContaining([["book", UUID], ["books"]]),
    );
    // The book page and lists build the cover from this, so it has to have moved on.
    await expect(coverUrl(toEditableBook(BOOK).uuid)).toMatch(/\?v=1$/);
  },
};

export const RevertAsksFirstAndCancelWritesNothing: Story = {
  beforeEach({ msw }) {
    msw.use(http.get("/api/ebooks/:uuid", () => HttpResponse.json(OVERRIDDEN)));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(
      await dialog.findByRole("button", { name: "Revert to scanned values" }),
    );

    await userEvent.click(
      await canvas.findByRole("button", { name: "Cancel" }),
    );

    await expect(canvas.queryByRole("button", { name: "Revert" })).toBeNull();
    await expect(reverted.count).toBe(0);
    await expect(dialog.getByLabelText(/^Title/)).toBeVisible();
  },
};

export const RevertFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/ebooks/:uuid", () => HttpResponse.json(OVERRIDDEN)),
      ...overridesHandlers(OVERRIDDEN, { refuse: "not allowed" }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(
      await dialog.findByRole("button", { name: "Revert to scanned values" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revert" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "not allowed",
    );
    await expect(
      canvas.getByRole("dialog", { name: "Revert to scanned values?" }),
    ).toBeInTheDocument();
  },
};

export const NoRevertForABookWithoutOverrides: Story = {
  play: async ({ canvas }) => {
    const dialog = await sheet(canvas);
    await dialog.findByLabelText(/^Title/);

    await expect(
      dialog.queryByRole("button", { name: "Revert to scanned values" }),
    ).not.toBeInTheDocument();
  },
};

export const AddsTag: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.type(await dialog.findByLabelText("Tags"), "cozy{Enter}");

    await expect(dialog.getByText("cozy")).toBeInTheDocument();
    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "1 unsaved change",
    );
    await userEvent.click(dialog.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(saved).toEqual([{ subjects: ["space opera", "cozy"] }]),
    );
  },
};

export const PrintPagesNotANumber: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const pages = await dialog.findByLabelText(/^Print pages/);
    await userEvent.clear(pages);

    await userEvent.type(pages, "abc");

    // Said as it is typed, under the field, and Done waits on it.
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Print page count must be a whole number.",
    );
    await expect(pages).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(saved).toEqual([]);

    await userEvent.clear(pages);
    await userEvent.type(pages, "320");
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled(),
    );
  },
};

export const IsbnIsRefusedAsItIsTyped: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const isbn = await dialog.findByLabelText(/^ISBN-13/);
    await userEvent.clear(isbn);

    await userEvent.type(isbn, "978-0");

    await expect(
      await dialog.findByText("ISBN-13 must be exactly 13 digits"),
    ).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(
      dialog.getByText("Fix the highlighted field to save"),
    ).toBeInTheDocument();

    await userEvent.clear(isbn);
    await userEvent.type(isbn, "9780134685991");
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled(),
    );
  },
};

export const SavingFromTheLeaveBarWithARefusedFieldShowsIt: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(dialog.getByRole("tab", { name: "Artwork" }));
    await userEvent.click(dialog.getByRole("tab", { name: "Details" }));
    const isbn = await dialog.findByLabelText(/^ISBN-10/);
    await userEvent.type(isbn, "12");
    // On another tab, so the refused field is out of sight when Save is pressed.
    await userEvent.click(dialog.getByRole("tab", { name: "Identifiers" }));
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    await userEvent.click(
      within(dialog.getByTestId("es-leave")).getByRole("button", {
        name: "Save",
      }),
    );

    await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(isbn).toHaveFocus());
    await expect(saved).toEqual([]);
  },
};

export const ReplacingTheCoverIsHeldUntilDone: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(dialog.getByRole("tab", { name: "Artwork" }));

    await userEvent.upload(
      await dialog.findByLabelText("Replace cover"),
      PICK(),
    );

    // Counted with the fields, shown on the Artwork tab and in the head, and not written yet.
    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "1 unsaved change",
    );
    await expect(dialog.getByRole("tab", { name: "Artwork" })).toHaveAttribute(
      "data-edited",
    );
    await expect(dialog.getByTestId("cover-hint")).toHaveTextContent(
      "your image · saved when you press Done",
    );
    await expect(
      dialog.getByTestId("cover-staged-preview").querySelector("img"),
    ).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    await expect(uploaded).toEqual([]);

    await userEvent.click(dialog.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(uploaded).toEqual(["new-cover.png"]));
    await expect(
      await canvas.findByText("Saved 1 change to Aurora Station, Vol. 1"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
  },
};

export const AnImageUrlIsHeldUntilDone: Story = {
  beforeEach({ msw }) {
    msw.use(...coverWriteHandlers(BOOK, { fetched: FETCHED }));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(dialog.getByRole("tab", { name: "Artwork" }));
    await userEvent.type(
      await dialog.findByLabelText("Or paste an image URL"),
      "https://example.test/cover.png",
    );

    await userEvent.click(dialog.getByRole("button", { name: "Apply" }));

    await expect(dialog.getByTestId("cover-hint")).toHaveTextContent(
      "from the web · saved when you press Done",
    );
    await expect(FETCHED).toEqual([]);
    await userEvent.click(dialog.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(FETCHED).toEqual(["https://example.test/cover.png"]),
    );
  },
};

export const DiscardEditsDropsAHeldCover: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(dialog.getByRole("tab", { name: "Artwork" }));
    await userEvent.upload(
      await dialog.findByLabelText("Replace cover"),
      PICK(),
    );
    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "1 unsaved change",
    );

    await userEvent.click(
      dialog.getByRole("button", { name: "Discard edits" }),
    );

    await expect(dialog.getByTestId("es-save-state")).toHaveTextContent(
      "No changes",
    );
    await expect(dialog.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(uploaded).toEqual([]);
  },
};

export const DontSaveDropsAHeldCover: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(dialog.getByRole("tab", { name: "Artwork" }));
    await userEvent.upload(
      await dialog.findByLabelText("Replace cover"),
      PICK(),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));

    await userEvent.click(
      await dialog.findByRole("button", { name: "Don’t save" }),
    );

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(uploaded).toEqual([]);
  },
};

let coverGate = deferred();

export const HoldsDoneAndRevertWhileTheCoverUploads: Story = {
  beforeEach({ msw }) {
    coverGate = deferred();
    msw.use(
      http.get("/api/ebooks/:uuid", () => HttpResponse.json(OVERRIDDEN)),
      ...coverWriteHandlers(OVERRIDDEN, { gate: coverGate.promise, uploaded }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    await userEvent.click(dialog.getByRole("tab", { name: "Artwork" }));
    await userEvent.upload(
      await dialog.findByLabelText("Replace cover"),
      PICK(),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Done" }));

    await expect(
      await dialog.findByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    // Nothing else may write while the cover is in flight, nor can the sheet be left.
    await expect(dialog.getByTestId("es-discard")).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(dialog.getByRole("tab", { name: "Details" })).toBeVisible();
    coverGate.release();

    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
    await expect(uploaded).toEqual(["new-cover.png"]);
  },
};

let saveGate = deferred();

export const HoldsTheFieldsWhileSaving: Story = {
  beforeEach({ msw }) {
    saveGate = deferred();
    msw.use(
      http.post("/api/ebooks/:uuid/overrides", async () => {
        await saveGate.promise;
        return HttpResponse.json(BOOK);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    await userEvent.type(title, "!");
    await userEvent.click(dialog.getByRole("button", { name: "Done" }));

    await expect(
      await dialog.findByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    await expect(title).toBeDisabled();
    await expect(dialog.getByLabelText("Authors")).toBeDisabled();
    saveGate.release();
    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: DIALOG }),
      ).not.toBeInTheDocument(),
    );
  },
};

export const KeepsTheFormWhenARefetchFails: Story = {
  beforeEach({ msw }) {
    // The page's read, then the editor's, answer; every later one fails.
    msw.use(
      http.get("/api/ebooks/:uuid", () =>
        ++bookReads.count <= 2
          ? HttpResponse.json(BOOK)
          : new HttpResponse("down", { status: 500 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    await userEvent.type(title, "!");
    await storyClient().invalidateQueries({
      queryKey: ["book", UUID, "edit"],
    });

    await waitFor(() => expect(bookReads.count).toBe(3));
    await expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    await expect(dialog.getByLabelText(/^Title/)).toHaveValue(
      "Aurora Station, Vol. 1!",
    );
  },
};

export const RevertingTheScannedCoverLeavesTheFormAlone: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/ebooks/:uuid", () => HttpResponse.json(OVERRIDDEN)),
      ...coverWriteHandlers(OVERRIDDEN),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await sheet(canvas);
    const title = await dialog.findByLabelText(/^Title/);
    await userEvent.type(title, "!");
    await userEvent.click(dialog.getByRole("tab", { name: "Artwork" }));

    await userEvent.click(
      await dialog.findByRole("button", { name: "Revert to scanned cover" }),
    );

    await expect(
      await dialog.findByText("Reverted to scanned cover."),
    ).toBeInTheDocument();
    await expect(dialog.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(title).toHaveValue("Aurora Station, Vol. 1!");
    await expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    // The cover write marks the page stale without refetching the record the form is built on.
    await expect(
      storyClient().getQueryState(["book", UUID, "edit"])?.isInvalidated,
    ).toBe(false);
  },
};

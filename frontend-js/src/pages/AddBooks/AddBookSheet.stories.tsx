import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Route, Routes } from "react-router";
import { userEvent as events, expect, waitFor, within } from "storybook/test";
import { expectInvalidated, seedQueries } from "../../testing/AppHarness";
import { filterOptionHandlers } from "../../testing/handlers";
import {
  aProviderEdition,
  editionSearchHandler,
  hydrateHandler,
  providersHandler,
} from "../../testing/metadataHandlers";
import { unloadPrevented } from "../../testing/unloadGuard";
import {
  anAudiobookInspection,
  type Committed,
  commitHandlers,
  inspectHandlers,
} from "../../testing/uploadHandlers";
import { AddBookSheet } from "./AddBookSheet";

// What adding a book marks stale for the lists.
const ADD_KEYS = [
  ["books"],
  ["shelves"],
  ["shelf-page"],
  ["authors"],
  ["author"],
  ["series"],
  ["name-counts"],
];
const NEW_UUID = "0d3f1c2e-6c1a-4a53-9a43-4d7a1b3f9a10";
const inspected: string[][] = [];
const committed: Committed[] = [];
const gate = { release: () => {} };

const epub = (name = "salt-road.epub") =>
  new File(["epub"], name, { type: "application/epub+zip" });
const mp3 = (name: string) => new File(["mp3"], name, { type: "audio/mpeg" });
// A real 1x1 image, so a cover shown from its object URL stays an image.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const png = () => new File([PNG], "mine.png", { type: "image/png" });
// Picks the dialog's own `accept` list would filter out.
const pick = (input: HTMLElement, files: File[]) =>
  events.setup({ applyAccept: false }).upload(input, files);

/** The sheet over a page that can close it, and the book page View book opens. */
function Page() {
  const [open, setOpen] = useState(true);
  return (
    <Routes>
      <Route
        path="/"
        element={
          open ? (
            <AddBookSheet onClosed={() => setOpen(false)} />
          ) : (
            <p>Sheet closed</p>
          )
        }
      />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  );
}

const meta = {
  title: "Pages/AddBookSheet",
  component: Page,
  beforeEach({ msw }) {
    inspected.length = 0;
    committed.length = 0;
    msw.use(
      ...inspectHandlers({}, { inspected }),
      ...commitHandlers(NEW_UUID, { committed }),
      providersHandler(false),
      ...filterOptionHandlers(),
    );
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;
type Ctx = Parameters<NonNullable<Story["play"]>>[0];

const addButton = (canvas: Ctx["canvas"]) =>
  canvas.getByRole("button", { name: "Add to library" });

/** Picks an EPUB and waits for its review. */
async function review({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.upload(await canvas.findByLabelText("Choose files"), epub());
  await canvas.findByRole("tab", { name: "Details" });
}

export const Layout: Story = {
  play: async ({ canvas }) => {
    const sheet = await canvas.findByRole("dialog", { name: "Add a book" });
    await expect(
      within(sheet).getByRole("heading", { name: "Add a book" }),
    ).toBeInTheDocument();
    const input = canvas.getByLabelText("Choose files");
    await expect(input).toHaveAttribute("multiple");
    await expect(input).toHaveAttribute(
      "accept",
      ".epub,.pdf,.m4b,.m4a,.mp4,.mp3,application/epub+zip,application/pdf,audio/mp4,audio/mpeg",
    );
    await expect(canvas.getByTestId("add-book-formats")).toHaveTextContent(
      "EbookEPUB or PDFAudiobookM4B, M4A or MP4Audiobook in partsEvery MP3 of one book, chosen together",
    );
    await expect(canvas.queryByRole("tab")).toBeNull();
  },
};

export const InspectsEpub: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await expect(canvas.getByTestId("es-title")).toHaveTextContent(
      "The Salt Road",
    );
    await expect(canvas.getByTestId("es-author")).toHaveTextContent(
      "Mara Okafor",
    );
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue("The Salt Road");
    await expect(canvas.getByLabelText(/^Series/)).toHaveValue("Tidewater");
    await expect(canvas.getByText("Jun Aoki")).toBeInTheDocument();
    await expect(canvas.getByTestId("add-book-file")).toHaveTextContent(
      "salt-road.epub",
    );
    await expect(addButton(canvas)).toBeEnabled();
    await expect(inspected).toEqual([["salt-road.epub"]]);
  },
};

export const ShowsTheFileIdentifiers: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await userEvent.click(canvas.getByRole("tab", { name: "Identifiers" }));

    await expect(canvas.getByTestId("es-identifiers")).toHaveTextContent(
      "ISBN9780134685991",
    );
  },
};

export const InspectsPdf: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      epub("scan.pdf"),
    );

    await canvas.findByRole("tab", { name: "Details" });
    await expect(inspected).toEqual([["scan.pdf"]]);
  },
};

export const InspectsAudiobookParts: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers({ audiobook: anAudiobookInspection() }, { inspected }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText("Choose files"), [
      mp3("part-1.mp3"),
      mp3("part-2.mp3"),
    ]);

    await canvas.findByRole("tab", { name: "Details" });
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue("Harbour Lights");
    await expect(canvas.getByTestId("add-book-file")).toHaveTextContent(
      "2 parts selected",
    );
    await expect(inspected).toEqual([["part-1.mp3", "part-2.mp3"]]);
  },
};

export const InspectFailsForAnEpub: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers(
        {},
        { inspected, refuse: { status: 400, text: "not a valid epub" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      epub(),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t read that EPUB: not a valid epub",
    );
    await expect(canvas.getByTestId("add-book-file")).toHaveTextContent(
      "salt-road.epub",
    );
    await expect(canvas.queryByRole("tab")).toBeNull();
  },
};

export const InspectFailsForAnAudiobook: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers(
        {},
        { inspected, refuse: { status: 400, text: "no audio found" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      mp3("a.mp3"),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t read that audiobook: no audio found",
    );
  },
};

export const InspectTooLarge: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers({}, { inspected, refuse: { status: 413, text: "" } }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      epub(),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t read that EPUB: That file is larger than this server accepts.",
    );
  },
};

export const ChoosesAnotherFileAfterAFailedRead: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers(
        {},
        { inspected, refuse: { status: 400, text: "not a valid epub" } },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      epub(),
    );
    await canvas.findByRole("alert");

    await userEvent.click(
      canvas.getByRole("button", { name: "Choose another file" }),
    );

    await expect(canvas.queryByRole("alert")).toBeNull();
    await expect(canvas.getByText("Drop a book here")).toBeInTheDocument();
  },
};

export const RefusesPicksBeforeSending: Story = {
  play: async ({ canvas }) => {
    const input = await canvas.findByLabelText("Choose files");
    const alert = () => canvas.getByRole("alert");

    await pick(input, [new File(["x"], "notes.txt")]);
    await expect(alert()).toHaveTextContent(
      "notes.txt isn't a format Omnibus can add",
    );

    await pick(input, [epub("a.epub"), epub("b.epub")]);
    await expect(alert()).toHaveTextContent("Add one EPUB at a time.");

    await pick(input, [epub("a.epub"), mp3("b.mp3")]);
    await expect(alert()).toHaveTextContent(
      "Pick either an EPUB or an audiobook's files, not both.",
    );
    await expect(inspected).toEqual([]);
  },
};

export const ShowsTheUploadWhileItGoesUp: Story = {
  beforeEach({ msw }) {
    let release = () => {};
    gate.release = () => release();
    msw.use(
      ...inspectHandlers(
        {},
        { inspected, gate: new Promise<void>((r) => (release = r)) },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      epub(),
    );

    // The live text never changes with the percentage; the figure sits outside it.
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      /^Reading the file…$/,
    );
    await expect(canvas.getByText(/\d+%/)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(canvas.getByLabelText("Upload progress")).toBeInTheDocument();
    await expect(canvas.getByTestId("add-book-file")).toHaveTextContent(
      "salt-road.epub",
    );

    gate.release();
    await canvas.findByRole("tab", { name: "Details" });
    await expect(canvas.queryByLabelText("Upload progress")).toBeNull();
  },
};

export const StagesACoverFromAFile: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.click(canvas.getByRole("tab", { name: "Artwork" }));

    await userEvent.upload(
      canvas.getByTestId("cover-upload-input"),
      new File(["png"], "mine.png", { type: "image/png" }),
    );

    await expect(await canvas.findByText("Cover staged.")).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "your image · saved with the book",
    );
    await expect(canvas.getByRole("tab", { name: "Artwork" })).toHaveAttribute(
      "data-edited",
    );

    await userEvent.click(canvas.getByTestId("cover-remove-override"));

    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(
      canvas.getByRole("tab", { name: "Artwork" }),
    ).not.toHaveAttribute("data-edited");
  },
};

export const ChoosesAnotherFileFromTheReview: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await userEvent.click(
      canvas.getByRole("button", { name: "Choose another file" }),
    );

    await expect(canvas.queryByRole("tab")).toBeNull();
    await expect(canvas.getByText("Drop a book here")).toBeInTheDocument();
    await expect(inspected).toEqual([["salt-road.epub"]]);
  },
};

const EPUB_FIELDS: Committed["fields"] = [
  ["title", "The Salt Road"],
  ["author", "Mara Okafor"],
  ["series", "Tidewater"],
  ["series_index", "2"],
  ["file", "file:salt-road.epub"],
];

export const AddsTheBookUntouched: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    seedQueries(ADD_KEYS);

    await userEvent.click(addButton(canvas));

    await expect(
      await canvas.findByRole("heading", { name: "Added to your library" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("add-book-added")).toHaveTextContent(
      "The Salt Road",
    );
    // Focus follows the new step, so a screen reader hears the add land.
    await expect(
      canvas.getByRole("button", { name: "Add another book" }),
    ).toHaveFocus();
    await expect(committed).toEqual([{ route: "ebooks", fields: EPUB_FIELDS }]);
    await expectInvalidated(ADD_KEYS);
  },
};

export const AddsTheEditsAsOverrides: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    const title = canvas.getByLabelText(/^Title/);
    await userEvent.clear(title);
    await userEvent.type(title, "  The Salt Road, Revised ");

    await userEvent.click(addButton(canvas));

    await canvas.findByRole("heading", { name: "Added to your library" });
    await expect(committed[0]?.fields).toEqual([
      ["title", "The Salt Road, Revised"],
      ["author", "Mara Okafor"],
      ["series", "Tidewater"],
      ["series_index", "2"],
      ["overrides", JSON.stringify({ title: "  The Salt Road, Revised " })],
      ["file", "file:salt-road.epub"],
    ]);
  },
};

export const AddsAnAudiobookFromEveryPart: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText("Choose files"), [
      mp3("part-1.mp3"),
      mp3("part-2.mp3"),
    ]);
    await canvas.findByRole("tab", { name: "Details" });

    await userEvent.click(addButton(canvas));

    await canvas.findByRole("heading", { name: "Added to your library" });
    await expect(committed).toEqual([
      {
        route: "audiobooks",
        fields: [
          ["title", "Harbour Lights"],
          ["author", "Ines Varga"],
          ["file", "file:part-1.mp3"],
          ["file", "file:part-2.mp3"],
        ],
      },
    ]);
  },
};

export const AddsTheStagedCoverFile: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.click(canvas.getByRole("tab", { name: "Artwork" }));
    await userEvent.upload(canvas.getByTestId("cover-upload-input"), png());
    await canvas.findByText("Cover staged.");

    await userEvent.click(addButton(canvas));

    await canvas.findByRole("heading", { name: "Added to your library" });
    await expect(committed[0]?.fields.slice(-2)).toEqual([
      ["cover", "file:mine.png"],
      ["file", "file:salt-road.epub"],
    ]);
    // The Added step shows the staged file, so its object URL must outlive the review.
    const src =
      within(canvas.getByTestId("add-book-added"))
        .getByRole("img")
        .getAttribute("src") ?? "";
    await expect(src).toMatch(/^blob:/);
    await expect((await fetch(src)).ok).toBe(true);
  },
};

const EDITION = aProviderEdition({
  title: "The Salt Road",
  authors: ["Mara Okafor"],
  cover_url: "https://images.example.com/salt.jpg",
});

export const AddsAFetchedCover: Story = {
  beforeEach({ msw }) {
    msw.use(
      providersHandler(true),
      editionSearchHandler({
        editions: [EDITION],
        sources: [
          {
            provider: "open_library",
            display_name: "Open Library",
            status: { kind: "answered", count: 1 },
          },
        ],
      }),
      hydrateHandler({ [EDITION.provider_ref]: EDITION }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await userEvent.click(
      await canvas.findByRole("button", { name: "Fetch metadata" }),
    );
    const view = within(
      await canvas.findByRole("region", { name: "Fetch metadata" }),
    );
    await userEvent.click(await view.findByRole("button", { name: /Salt/ }));
    // The file has a cover, so a fetched one starts unchecked.
    await userEvent.click(await view.findByRole("checkbox", { name: /Cover/ }));
    await expect(view.getByText("Added with the book")).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "Apply 1 change" }));
    await userEvent.click(addButton(canvas));

    await canvas.findByRole("heading", { name: "Added to your library" });
    await expect(committed[0]?.fields.slice(-2)).toEqual([
      ["cover_url", "https://images.example.com/salt.jpg"],
      ["file", "file:salt-road.epub"],
    ]);
  },
};

export const RefusesWithoutATitle: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.clear(canvas.getByLabelText(/^Title/));

    await userEvent.click(addButton(canvas));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "A title and at least one author are required.",
    );
    await expect(committed).toEqual([]);
  },
};

export const RefusesWithoutAnAuthor: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers(
        { audiobook: anAudiobookInspection({ author: null, creators: [] }) },
        { inspected },
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      mp3("a.mp3"),
    );
    await canvas.findByRole("tab", { name: "Details" });

    await userEvent.click(addButton(canvas));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "A title and at least one author are required.",
    );
    await expect(committed).toEqual([]);
  },
};

export const RefusesPrintPagesThatAreNotANumber: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText(/^Print pages/), "many");

    await expect(
      await canvas.findByText("Print page count must be a whole number."),
    ).toBeInTheDocument();
    await expect(addButton(canvas)).toBeDisabled();
    await expect(committed).toEqual([]);
  },
};

export const ShowsTheAddWhileItGoesUp: Story = {
  beforeEach({ msw }) {
    let release = () => {};
    gate.release = () => release();
    msw.use(
      ...commitHandlers(NEW_UUID, {
        committed,
        gate: new Promise<void>((r) => (release = r)),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await userEvent.click(addButton(canvas));

    await expect(
      await canvas.findByRole("button", { name: /^Adding… \d+%$/ }),
    ).toBeDisabled();
    await expect(canvas.getByLabelText("Upload progress")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Choose another file" }),
    ).toBeDisabled();

    // Nothing can cancel the upload, so nothing may offer to leave it behind.
    const close = canvas.getByRole("button", { name: "Close" });
    await expect(close).toBeDisabled();
    await userEvent.click(close);
    await expect(canvas.queryByTestId("add-book-leave")).toBeNull();
    await expect(canvas.queryByText("Sheet closed")).toBeNull();

    gate.release();
    await expect(
      await canvas.findByRole("heading", { name: "Added to your library" }),
    ).toBeInTheDocument();
  },
};

export const KeepsTheReviewWhenTheAddFails: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...commitHandlers(NEW_UUID, {
        committed,
        refuse: { status: 409, text: "that book is already in the library" },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText(/^Title/), "!");

    await userEvent.click(addButton(canvas));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t add the book: that book is already in the library",
    );
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue("The Salt Road!");
    await expect(addButton(canvas)).toBeEnabled();
  },
};

export const ExplainsAnAddThatIsTooLarge: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...commitHandlers(NEW_UUID, {
        committed,
        refuse: { status: 413, text: "" },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await userEvent.click(addButton(canvas));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t add the book: That file is larger than this server accepts.",
    );
  },
};

export const ViewBookOpensTheNewBook: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.click(addButton(canvas));

    const view = await canvas.findByRole("link", { name: "View book" });
    await expect(view).toHaveAttribute("href", `/books/${NEW_UUID}`);
    await userEvent.click(view);

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
  },
};

export const AddAnotherBookStartsOver: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.click(addButton(canvas));

    await userEvent.click(
      await canvas.findByRole("button", { name: "Add another book" }),
    );

    await expect(canvas.getByText("Drop a book here")).toBeInTheDocument();
    await userEvent.upload(
      canvas.getByLabelText("Choose files"),
      epub("b.epub"),
    );
    await expect(await canvas.findByLabelText(/^Title/)).toHaveValue(
      "The Salt Road",
    );
    await expect(inspected).toEqual([["salt-road.epub"], ["b.epub"]]);
  },
};

export const ClosesAtOnceWithoutEdits: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await userEvent.click(canvas.getByRole("button", { name: "Close" }));

    await expect(await canvas.findByText("Sheet closed")).toBeInTheDocument();
  },
};

export const AsksBeforeDroppingEdits: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText(/^Title/), "!");

    await userEvent.click(canvas.getByRole("button", { name: "Close" }));
    const leave = within(await canvas.findByTestId("add-book-leave"));
    await userEvent.click(leave.getByRole("button", { name: "Keep editing" }));

    await expect(canvas.queryByTestId("add-book-leave")).toBeNull();
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue("The Salt Road!");
    // Focus goes back to the Close that asked, not to the dialog's root.
    await expect(canvas.getByRole("button", { name: "Close" })).toHaveFocus();

    await userEvent.click(canvas.getByRole("button", { name: "Close" }));
    await userEvent.click(
      within(await canvas.findByTestId("add-book-leave")).getByRole("button", {
        name: "Discard book",
      }),
    );

    await waitFor(() =>
      expect(canvas.getByText("Sheet closed")).toBeInTheDocument(),
    );
    await expect(committed).toEqual([]);
  },
};

export const AsksBeforeEscapeDropsEdits: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText(/^Title/), "!");

    await userEvent.keyboard("{Escape}");

    await expect(await canvas.findByTestId("add-book-leave")).toBeVisible();
    await expect(canvas.queryByText("Sheet closed")).toBeNull();
  },
};

export const AsksBeforeChoosingAnotherFileDropsEdits: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText(/^Title/), "!");

    await userEvent.click(
      canvas.getByRole("button", { name: "Choose another file" }),
    );
    const leave = within(await canvas.findByTestId("add-book-leave"));
    await expect(canvas.queryByText("Drop a book here")).toBeNull();
    await userEvent.click(leave.getByRole("button", { name: "Discard book" }));

    await expect(await canvas.findByText("Drop a book here")).toBeVisible();
    await expect(canvas.queryByText("Sheet closed")).toBeNull();
  },
};

export const StartsCleanAfterAFailedAddAndAnotherFile: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers({ audiobook: anAudiobookInspection() }, { inspected }),
      ...commitHandlers(NEW_UUID, {
        committed,
        refuse: { status: 409, text: "that book is already in the library" },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.click(addButton(canvas));
    await canvas.findByText(/Couldn’t add the book/);

    await userEvent.click(
      canvas.getByRole("button", { name: "Choose another file" }),
    );
    await userEvent.upload(
      await canvas.findByLabelText("Choose files"),
      mp3("a.mp3"),
    );

    await expect(await canvas.findByLabelText(/^Title/)).toHaveValue(
      "Harbour Lights",
    );
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const WarnsBeforeTheTabClosesWithEdits: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await expect(unloadPrevented()).toBe(false);

    await userEvent.type(canvas.getByLabelText(/^Title/), "!");

    await expect(unloadPrevented()).toBe(true);
  },
};

export const IgnoresAFileDroppedOutsideTheZone: Story = {
  play: async ({ canvas }) => {
    const sheet = await canvas.findByRole("dialog", { name: "Add a book" });
    const prevented = (type: string, target: Element) => {
      const event = new DragEvent(type, { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const heading = within(sheet).getByRole("heading", { name: "Add a book" });
    const input = canvas.getByLabelText("Choose files");

    // The browser opens a dropped file in the tab unless something refuses it.
    await expect(prevented("dragover", heading)).toBe(true);
    await expect(prevented("drop", heading)).toBe(true);
    // The zone's own input keeps its default, which is what takes the file.
    await expect(prevented("dragover", input)).toBe(false);
    await expect(prevented("drop", input)).toBe(false);
  },
};

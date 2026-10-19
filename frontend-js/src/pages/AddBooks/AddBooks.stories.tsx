import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { userEvent as events, expect } from "storybook/test";
import { storyClient } from "../../testing/AppHarness";
import { filterOptionHandlers } from "../../testing/handlers";
import {
  aProviderEdition,
  editionSearchHandler,
  hydrateHandler,
  providersHandler,
} from "../../testing/metadataHandlers";
import {
  anAudiobookInspection,
  type Committed,
  commitHandlers,
  inspectHandlers,
} from "../../testing/uploadHandlers";
import { WIRE_ADA } from "../../testing/wire";
import { AddBooks } from "./AddBooks";

const NEW_UUID = "0d3f1c2e-6c1a-4a53-9a43-4d7a1b3f9a10";
const inspected: string[][] = [];
const committed: Committed[] = [];
const gate = { release: () => {} };

const epub = (name = "salt-road.epub") =>
  new File(["epub"], name, { type: "application/epub+zip" });
const mp3 = (name: string) => new File(["mp3"], name, { type: "audio/mpeg" });
// Picks the dialog's own `accept` list would filter out.
const pick = (input: HTMLElement, files: File[]) =>
  events.setup({ applyAccept: false }).upload(input, files);

function Page() {
  return (
    <Routes>
      <Route path="/" element={<AddBooks />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  );
}

const meta = {
  title: "Pages/AddBooks",
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

export const Layout: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Upload a book" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("choose a file")).toBeInTheDocument();
    const input = canvas.getByLabelText("Book files");
    await expect(input).toHaveAttribute("multiple");
    await expect(input).toHaveAttribute(
      "accept",
      ".epub,.pdf,.m4b,.m4a,.mp4,.mp3,application/epub+zip,application/pdf,audio/mp4,audio/mpeg",
    );
    await expect(canvas.getByTestId("add-books-formats")).toHaveTextContent(
      "EPUB, PDF, M4B, M4A, MP4, or the MP3 parts of one audiobook.",
    );
    await expect(canvas.queryByTestId("add-books-review")).toBeNull();
  },
};

export const Forbidden: Story = {
  parameters: { user: { ...WIRE_ADA, can_upload: false } },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("add-books-forbidden"),
    ).toHaveTextContent(
      "You don't have permission to add books to this library.",
    );
    await expect(
      canvas.getByRole("heading", { name: "Upload a book" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByLabelText("Book files")).toBeNull();
  },
};

export const InspectsEpub: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText("Book files"), epub());

    const review = await canvas.findByTestId("add-books-review");
    await expect(canvas.getByTestId("add-books-status")).toHaveTextContent(
      "Review the details, then add it to your library.",
    );
    await expect(
      canvas.getByText("salt-road.epub", { selector: ".file-drop-filename" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Click to change")).toBeInTheDocument();
    await expect(review).toHaveTextContent("Review before adding");
    await expect(review).toHaveTextContent(
      "nothing is saved until you add the book",
    );
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue("The Salt Road");
    await expect(canvas.getByLabelText(/^Filename/)).toHaveValue(
      "salt-road.epub",
    );
    await expect(canvas.getByLabelText(/^Series/)).toHaveValue("Tidewater");
    await expect(canvas.getByText("Jun Aoki")).toBeInTheDocument();
    await expect(
      canvas.getByTestId("cover-staged-preview"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(
      canvas.getByText("9780134685991", { selector: ".me-ident-val" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("No changes")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Add to library" }),
    ).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Start over" }),
    ).toBeInTheDocument();
    await expect(inspected).toEqual([["salt-road.epub"]]);
  },
};

export const InspectsPdf: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByLabelText("Book files"),
      epub("scan.pdf"),
    );

    await canvas.findByTestId("add-books-review");
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
    await userEvent.upload(await canvas.findByLabelText("Book files"), [
      mp3("part-1.mp3"),
      mp3("part-2.mp3"),
    ]);

    await canvas.findByTestId("add-books-review");
    await expect(canvas.getByText("2 parts selected")).toBeInTheDocument();
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue("Harbour Lights");
    await expect(canvas.getByLabelText(/^Filename/)).toHaveValue(
      "2 parts selected",
    );
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "no cover available",
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
    await userEvent.upload(await canvas.findByLabelText("Book files"), epub());

    await expect(
      await canvas.findByText("Could not read that EPUB: not a valid epub"),
    ).toHaveClass("error");
    await expect(canvas.queryByTestId("add-books-review")).toBeNull();
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
      await canvas.findByLabelText("Book files"),
      mp3("a.mp3"),
    );

    await expect(
      await canvas.findByText("Could not read that audiobook: no audio found"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("add-books-review")).toBeNull();
  },
};

export const InspectTooLarge: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inspectHandlers({}, { inspected, refuse: { status: 413, text: "" } }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText("Book files"), epub());

    await expect(
      await canvas.findByText(
        "Could not read that EPUB: That file is larger than this server accepts.",
      ),
    ).toBeInTheDocument();
  },
};

export const RefusesPicksBeforeSending: Story = {
  play: async ({ canvas }) => {
    const input = await canvas.findByLabelText("Book files");
    const status = () => canvas.getByTestId("add-books-status");

    await pick(input, [new File(["x"], "notes.txt")]);
    await expect(status()).toHaveTextContent(
      "notes.txt isn't a format Omnibus can add",
    );
    await expect(status()).toHaveClass("error");

    await pick(input, [epub("a.epub"), epub("b.epub")]);
    await expect(status()).toHaveTextContent("Add one EPUB at a time.");

    await pick(input, [epub("a.epub"), mp3("b.mp3")]);
    await expect(status()).toHaveTextContent(
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
    const input = await canvas.findByLabelText("Book files");
    await userEvent.upload(input, epub());

    const status = await canvas.findByTestId("add-books-status");
    await expect(status).toHaveClass("is-working");
    await expect(status).toHaveTextContent(/Uploading salt-road\.epub… \d+%/);
    await expect(canvas.getByLabelText("Upload progress")).toBeInTheDocument();
    await expect(input).toBeDisabled();

    gate.release();
    await canvas.findByTestId("add-books-review");
    await expect(canvas.queryByLabelText("Upload progress")).toBeNull();
    await expect(input).toBeEnabled();
  },
};

export const StagesACoverFromAFile: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText("Book files"), epub());
    await canvas.findByTestId("add-books-review");

    await userEvent.upload(
      canvas.getByTestId("cover-upload-input"),
      new File(["png"], "mine.png", { type: "image/png" }),
    );

    await expect(await canvas.findByText("Cover staged.")).toBeInTheDocument();
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "your image · saved with the book",
    );
    await expect(canvas.getByTestId("me-cover-replaced")).toHaveTextContent(
      "Cover replaced · saved with the book",
    );

    await userEvent.click(canvas.getByTestId("cover-remove-override"));
    await expect(canvas.getByTestId("cover-hint")).toHaveTextContent(
      "extracted from file",
    );
    await expect(canvas.getByText("No changes")).toBeInTheDocument();
  },
};

export const StartsOver: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText("Book files"), epub());
    await canvas.findByTestId("add-books-review");

    await userEvent.click(canvas.getByRole("button", { name: "Start over" }));

    await expect(canvas.queryByTestId("add-books-review")).toBeNull();
    await expect(canvas.queryByTestId("add-books-status")).toBeNull();
    await expect(canvas.getByText("choose a file")).toBeInTheDocument();
    await expect(inspected).toEqual([["salt-road.epub"]]);
  },
};

export const ANewPickStartsTheReviewOver: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByLabelText("Book files");
    await userEvent.upload(input, epub());
    await userEvent.type(await canvas.findByLabelText(/^Title/), "!");
    await expect(canvas.getByText("1 field edited")).toBeInTheDocument();

    await userEvent.upload(input, mp3("a.mp3"));

    await expect(
      await canvas.findByDisplayValue("Harbour Lights"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("No changes")).toBeInTheDocument();
  },
};

const EPUB_FIELDS: Committed["fields"] = [
  ["title", "The Salt Road"],
  ["author", "Mara Okafor"],
  ["series", "Tidewater"],
  ["series_index", "2"],
  ["file", "file:salt-road.epub"],
];

/** Picks an EPUB and waits for its review. */
async function review({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.upload(await canvas.findByLabelText("Book files"), epub());
  await canvas.findByTestId("add-books-review");
}

type Ctx = Parameters<NonNullable<Story["play"]>>[0];

export const AddsTheBookUntouched: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    for (const key of ["books", "shelves", "shelf-page"]) {
      storyClient().setQueryData([key], []);
    }

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
    await expect(committed).toEqual([{ route: "ebooks", fields: EPUB_FIELDS }]);
    for (const key of ["books", "shelves", "shelf-page"]) {
      await expect(storyClient().getQueryState([key])?.isInvalidated).toBe(
        true,
      );
    }
  },
};

export const AddsTheEditsAsOverrides: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    const title = canvas.getByLabelText(/^Title/);
    await userEvent.clear(title);
    await userEvent.type(title, "  The Salt Road, Revised ");

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await canvas.findByText("Book page");
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
    await userEvent.upload(await canvas.findByLabelText("Book files"), [
      mp3("part-1.mp3"),
      mp3("part-2.mp3"),
    ]);
    await canvas.findByTestId("add-books-review");

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await canvas.findByText("Book page");
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
    await userEvent.upload(
      canvas.getByTestId("cover-upload-input"),
      new File(["png"], "mine.png", { type: "image/png" }),
    );
    await canvas.findByText("Cover staged.");

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await canvas.findByText("Book page");
    await expect(committed[0]?.fields.slice(-2)).toEqual([
      ["cover", "file:mine.png"],
      ["file", "file:salt-road.epub"],
    ]);
  },
};

const EDITION = aProviderEdition({
  title: "The Salt Road",
  authors: ["Mara Okafor"],
  cover_url: "https://images.example.com/salt.jpg",
});

export const AddsAProviderCoverFromTheEditionPicker: Story = {
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
      hydrateHandler({ OL1M: EDITION }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });

    await userEvent.click(await canvas.findByTestId("metadata-search-btn"));
    await userEvent.click(canvas.getByTestId("mes-search"));
    await userEvent.click(await canvas.findByTestId("mes-candidate-0"));
    await userEvent.click(await canvas.findByTestId("mes-row-cover-apply"));
    await expect(await canvas.findByText("Cover staged.")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("mes-done"));
    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await canvas.findByText("Book page");
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

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

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
      await canvas.findByLabelText("Book files"),
      mp3("a.mp3"),
    );
    await canvas.findByTestId("add-books-review");

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "A title and at least one author are required.",
    );
    await expect(committed).toEqual([]);
  },
};

export const RefusesPrintPagesThatAreNotANumber: Story = {
  play: async ({ canvas, userEvent }) => {
    await review({ canvas, userEvent });
    await userEvent.type(canvas.getByLabelText(/^Print Pages/), "many");

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Print page count must be a whole number.",
    );
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

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    const status = await canvas.findByTestId("add-books-status");
    await expect(status).toHaveTextContent(/Adding to your library… \d+%/);
    await expect(canvas.getByLabelText("Upload progress")).toBeInTheDocument();
    await expect(canvas.getByTestId("me-save")).toHaveTextContent("Adding…");
    await expect(canvas.getByLabelText("Book files")).toBeDisabled();

    gate.release();
    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
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

    await userEvent.click(
      canvas.getByRole("button", { name: /^Add to library/ }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Upload failed: that book is already in the library",
    );
    await expect(canvas.getByTestId("add-books-status")).toHaveTextContent(
      "Upload failed: that book is already in the library",
    );
    await expect(canvas.getByLabelText(/^Title/)).toHaveValue("The Salt Road!");
    await expect(
      canvas.getByRole("button", { name: "Add to library" }),
    ).toBeEnabled();
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

    await userEvent.click(
      canvas.getByRole("button", { name: "Add to library" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Upload failed: That file is larger than this server accepts.",
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { userEvent as events, expect } from "storybook/test";
import { filterOptionHandlers } from "../../testing/handlers";
import { providersHandler } from "../../testing/metadataHandlers";
import {
  anAudiobookInspection,
  inspectHandlers,
} from "../../testing/uploadHandlers";
import { WIRE_ADA } from "../../testing/wire";
import { AddBooks } from "./AddBooks";

const inspected: string[][] = [];
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
    msw.use(
      ...inspectHandlers({}, { inspected }),
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
      "notes.txt isn't a format Omnibus can add — pick an EPUB or PDF, an M4B/M4A/MP4 audiobook, or MP3 parts.",
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

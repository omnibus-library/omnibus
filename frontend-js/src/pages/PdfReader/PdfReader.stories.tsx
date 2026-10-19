import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, fireEvent, waitFor } from "storybook/test";
import type { ProgressUpdate } from "../../api/generated/schemas";
import {
  bookHandler,
  hanging,
  readStatusHandlers,
} from "../../testing/handlers";
import { fakePdfGlue } from "../../testing/readerGlue";
import { progressHandlers } from "../../testing/readerHandlers";
import { aWireBook, aWirePosition, aWireReadStatus } from "../../testing/wire";
import { PdfReader } from "./PdfReader";

const BOOK = aWireBook({ formats: ["PDF"] });
const UUID = BOOK.unique_identifier;
const SAVED = aWirePosition({ epub_cfi: "pdf-page:2", progress_percent: 60 });

const writes: ProgressUpdate[] = [];
const statusWrites: { status: string }[] = [];
let glue: ReturnType<typeof fakePdfGlue>;

/** Installs the stand-in glue, so no real PDF.js runs; the story's cleanup removes it. */
function install(options?: Parameters<typeof fakePdfGlue>[0]) {
  glue = fakePdfGlue(options);
  return glue.restore;
}

const inits = () => glue.calls.filter((c) => c.method === "init");
const goTos = () => glue.calls.filter((c) => c.method === "goTo");

const meta = {
  title: "Pages/PdfReader",
  component: PdfReader,
  parameters: { path: `/pdf/${UUID}` },
  beforeEach({ msw }) {
    writes.length = 0;
    statusWrites.length = 0;
    msw.use(
      bookHandler(BOOK),
      ...progressHandlers([SAVED], writes),
      ...readStatusHandlers(aWireReadStatus(), statusWrites),
    );
    return install();
  },
  render: () => (
    <Routes>
      <Route path="/pdf/:uuid" element={<PdfReader />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  ),
} satisfies Meta<typeof PdfReader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("pdf-loading")).toHaveTextContent(
      "Setting the page",
    );
    await expect(
      canvas.getByRole("button", { name: "Back" }),
    ).toBeInTheDocument();
    await expect(inits()).toEqual([]);
  },
};

export const MissingBook: Story = {
  beforeEach({ msw }) {
    msw.use(bookHandler(aWireBook({ unique_identifier: "someone-else" })));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "This PDF could not be opened.",
    );
    await expect(canvas.queryByTestId("pdf-error-detail")).toBeNull();
    await expect(inits()).toEqual([]);
  },
};

export const FailsThenRetries: Story = {
  beforeEach() {
    let opens = 0;
    return install({
      onInit(opts) {
        opens += 1;
        if (opens === 1) {
          window.__omnibusOnPdfError?.("Invalid PDF structure.");
        } else {
          window.__omnibusOnPdfReady?.(
            JSON.stringify({ page: opts.startPage, pageCount: 5 }),
          );
        }
      },
    });
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "This PDF could not be opened.",
    );
    await expect(canvas.getByTestId("pdf-error-detail")).toHaveTextContent(
      "Invalid PDF structure.",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await canvas.findByText("Page 3 of 5");
    await expect(canvas.queryByRole("alert")).toBeNull();
    await expect(inits()).toHaveLength(2);
  },
};

export const OpensAtTheSavedPage: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Page 3 of 5");

    await expect(
      canvas.getByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    await expect(inits()).toHaveLength(1);
    const [id, opts] = inits()[0]?.args ?? [];
    await expect(id).toBe("omnibus-pdf-page");
    await expect(opts).toMatchObject({
      url: `/api/ebooks/${UUID}/file`,
      startPage: 2,
      fit: "height",
    });
    await expect(opts).toEqual(
      expect.objectContaining({
        pdfjs: expect.stringContaining("pdf.min"),
        worker: expect.stringContaining("pdf.worker.min"),
        wasmUrl: expect.stringMatching(/\/$/),
      }),
    );
    // The Ready report restates the resumed page; it must not post an echo.
    await expect(writes).toEqual([]);
  },
};

export const DeepLinkBeatsTheSavedPage: Story = {
  parameters: { path: `/pdf/${UUID}?file_id=3&page=4` },
  play: async ({ canvas }) => {
    await canvas.findByText("Page 4 of 5");

    await expect(inits()[0]?.args[1]).toMatchObject({
      url: `/api/ebooks/${UUID}/file?file_id=3`,
      startPage: 3,
    });
  },
};

export const IgnoresAForeignAnchor: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...progressHandlers(
        [aWirePosition({ epub_cfi: "comic-page:7", progress_percent: null })],
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Page 1 of 5");

    await expect(inits()[0]?.args[1]).toMatchObject({ startPage: 0 });
  },
};

export const SavesEveryTurn: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Page 3 of 5");

    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await canvas.findByText("Page 4 of 5");
    await userEvent.keyboard("{ArrowLeft}");
    await canvas.findByText("Page 3 of 5");
    fireEvent.change(canvas.getByRole("slider", { name: "Page slider" }), {
      target: { value: "0" },
    });
    await canvas.findByText("Page 1 of 5");

    await waitFor(() => expect(writes).toHaveLength(3));
    await expect(writes.map((w) => [w.epub_cfi, w.progress_percent])).toEqual([
      ["pdf-page:3", 80],
      ["pdf-page:2", 60],
      ["pdf-page:0", 20],
    ]);
    await expect(writes[0]).toMatchObject({ format: "epub" });
    await expect(goTos().map((c) => c.args[0])).toEqual([3, 2, 0]);
  },
};

export const SavesAPageTheGlueTurnedTo: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Page 3 of 5");

    window.__omnibusOnPdfPage?.(JSON.stringify({ page: 4, pageCount: 5 }));

    await canvas.findByText("Page 5 of 5");
    await waitFor(() => expect(writes).toHaveLength(1));
    await expect(writes[0]).toMatchObject({
      epub_cfi: "pdf-page:4",
      progress_percent: 100,
    });
  },
};

export const DropsAMalformedReport: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText("Page 3 of 5");

    window.__omnibusOnPdfPage?.("not json");
    window.__omnibusOnPdfPage?.(JSON.stringify({ page: "four" }));

    await expect(canvas.getByText("Page 3 of 5")).toBeInTheDocument();
    await expect(writes).toEqual([]);
  },
};

export const StopsAtTheEnds: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...progressHandlers(
        [aWirePosition({ epub_cfi: "pdf-page:4", progress_percent: 100 })],
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Page 5 of 5");
    await expect(
      canvas.getByRole("button", { name: "Next page" }),
    ).toBeDisabled();

    await userEvent.keyboard("{ArrowRight}");

    await expect(canvas.getByText("Page 5 of 5")).toBeInTheDocument();
    await expect(writes).toEqual([]);
  },
};

export const FitModes: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Page 3 of 5");
    const fitHeight = canvas.getByRole("button", { name: "Fit height" });
    const fitWidth = canvas.getByRole("button", { name: "Fit width" });
    await expect(fitHeight).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(fitWidth);

    await expect(fitWidth).toHaveAttribute("aria-pressed", "true");
    await expect(fitHeight).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByTestId("pdf-stage")).toHaveClass("cr-fit-width");
    await waitFor(() =>
      expect(glue.calls).toContainEqual({ method: "setFit", args: ["width"] }),
    );
  },
};

export const EscapeClearsTheSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Page 3 of 5");

    await userEvent.keyboard("{Escape}");

    await expect(glue.calls).toContainEqual({
      method: "clearSelection",
      args: [],
    });
  },
};

export const MarksAnUnreadPdfReading: Story = {
  beforeEach({ msw }) {
    msw.use(...readStatusHandlers(null, statusWrites));
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Page 3 of 5");

    await waitFor(() =>
      expect(statusWrites).toEqual([
        expect.objectContaining({ status: "reading" }),
      ]),
    );
  },
};

export const LeavesTheGlueClean: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Page 3 of 5");
    await expect(window.__omnibusOnPdfReady).toBeDefined();

    await userEvent.click(canvas.getByRole("button", { name: "Back" }));

    await expect(await canvas.findByText("Book page")).toBeInTheDocument();
    await expect(glue.calls.map((c) => c.method)).toContain("destroy");
    await expect(window.__omnibusOnPdfReady).toBeUndefined();
    await expect(window.__omnibusOnPdfPage).toBeUndefined();
    await expect(window.__omnibusOnPdfError).toBeUndefined();
  },
};

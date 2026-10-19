import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import {
  getGetEbookByUuidMockHandler404,
  getPostEbookOverridesMockHandler200,
} from "../../api/generated/omnibus.msw";
import {
  bookDetailHandlers,
  deletionHandlers,
  failing,
  mergeHandlers,
  physicalHandlers,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireFile,
  aWireManifest,
  WIRE_ADA,
} from "../../testing/wire";
import { BookDetail } from "./BookDetail";

const BOOK = aWireBook({
  series_id: 4,
  formats: ["EPUB"],
  book_files: [aWireFile()],
  genres: ["Science fiction"],
  subjects: ["Space opera", "First contact"],
  description: `<p>${"A station at the edge of the map hears something answer. ".repeat(6)}</p>`,
});

const writes: string[] = [];
const reads: string[] = [];

const meta = {
  title: "Pages/BookDetail",
  component: BookDetail,
  parameters: { path: `/books/${BOOK.unique_identifier}` },
  beforeEach() {
    writes.length = 0;
  },
  // The page reads its uuid from the route, as it does under the app router.
  render: () => (
    <Routes>
      <Route path="/books/:uuid" element={<BookDetail />} />
      <Route path="/" element={<p>The library</p>} />
    </Routes>
  ),
} satisfies Meta<typeof BookDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Aurora Station, Vol. 1" }),
    ).toBeInTheDocument();
    const series = await canvas.findByRole("link", { name: "Aurora Station" });
    await waitFor(() =>
      expect(series.parentElement).toHaveTextContent(
        "Aurora Station · Book 1 · 3 in your library · 2021",
      ),
    );
    await expect(canvas.getByText("First contact")).toBeInTheDocument();

    const toggle = canvas.getByRole("button", { name: "Show more" });
    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

export const SectionRail: Story = {
  // Two short sections can't scroll far enough to pass the reading line.
  decorators: [
    (Story) => (
      <>
        <style>{".bdmq-flowsec { min-height: 100vh; }"}</style>
        <Story />
      </>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const rail = await canvas.findByRole("navigation", {
      name: "Page sections",
    });
    const dots = within(rail).getAllByRole("button");
    const last = dots.at(-1) as HTMLElement;
    await expect(dots.map((dot) => dot.textContent)).toEqual([
      "01 · Home",
      "02 · Stats",
      "03 · Highlights",
      "04 · Journals",
      "05 · The files",
      "06 · More",
    ]);
    await expect(canvasElement.querySelectorAll(".bdmq-flowsec")).toHaveLength(
      6,
    );
    await expect(dots[0]).toHaveClass("on");

    await userEvent.click(last);

    await waitFor(() => expect(last).toHaveClass("on"), { timeout: 5000 });
    await expect(dots[0]).not.toHaveClass("on");
    await expect(
      canvas.getByRole("button", { name: "↑ back to the book" }),
    ).toHaveClass("on");

    await userEvent.click(
      canvas.getByRole("button", { name: "↑ back to the book" }),
    );

    await waitFor(() => expect(dots[0]).toHaveClass("on"));
  },
};

const FOUND =
  "A station at the edge of the map hears something answer, and the crew must decide whether to reply.";

export const FetchSummaryReplacesASparseDescription: Story = {
  beforeEach({ msw }) {
    const sparse = aWireBook({ ...BOOK, description: "<p>Too short.</p>" });
    msw.use(
      ...bookDetailHandlers(sparse),
      http.get("/api/summary/sources", () =>
        HttpResponse.json(["GoogleBooks"]),
      ),
      http.post("/api/ebooks/:uuid/summary/fetch", () =>
        HttpResponse.json(FOUND),
      ),
      getPostEbookOverridesMockHandler200({
        ...sparse,
        description: `<p>${FOUND}</p>`,
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Fetch Summary" }),
    );

    await expect(await canvas.findByText(FOUND)).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Fetch Summary" }),
    ).not.toBeInTheDocument();
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(getGetEbookByUuidMockHandler404());
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Book not found."),
    ).toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the book",
    );
  },
};

const NOT_ADMIN = { ...WIRE_ADA, is_admin: false };
const volume = aWireBook({
  id: 22,
  title: "Aurora Station, Vol. 2",
  unique_identifier: "00000000-0000-4000-8000-000000000002",
  formats: ["M4B"],
  cover_url: null,
});

export const AdminSeesMergeAndDelete: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("merge-with")).toHaveTextContent(
      "Merge with…",
    );
    await expect(canvas.getByTestId("delete-files")).toHaveTextContent(
      "Delete files…",
    );
  },
};

export const ReaderSeesNeither: Story = {
  parameters: { user: NOT_ADMIN },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("edit-metadata");
    await expect(canvas.queryByTestId("merge-with")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("delete-files")).not.toBeInTheDocument();
  },
};

export const FilelessRecordOffersDeleteRecordButNotMerge: Story = {
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers({ ...BOOK, formats: [], book_files: [] }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("delete-files")).toHaveTextContent(
      "Delete record…",
    );
    await expect(canvas.queryByTestId("merge-with")).not.toBeInTheDocument();
  },
};

export const MergeThenUndo: Story = {
  beforeEach({ msw }) {
    msw.use(...mergeHandlers([volume], writes), ...bookDetailHandlers(BOOK));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("merge-with"));
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(await canvas.findByTestId("merge-candidate"));
    await userEvent.click(canvas.getByTestId("merge-confirm"));

    await expect(
      await canvas.findByText(
        "Books merged. Undo is available until you leave this page.",
      ),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("merge-dialog")).not.toBeInTheDocument();
    await expect(writes).toEqual([
      `merge:${volume.unique_identifier}>${BOOK.unique_identifier}`,
    ]);

    await userEvent.click(canvas.getByTestId("merge-undo"));

    await waitFor(() => expect(writes).toContain("undo:5"));
    await waitFor(() =>
      expect(canvas.queryByTestId("merge-undo")).not.toBeInTheDocument(),
    );
  },
};

export const FailedUndoKeepsTheToastWithTheReason: Story = {
  beforeEach({ msw }) {
    msw.use(
      failing("post", "/api/books/merge/undo", 409),
      ...mergeHandlers([volume], writes),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("merge-with"));
    await userEvent.type(canvas.getByTestId("merge-search"), "aurora");
    await userEvent.click(await canvas.findByTestId("merge-candidate"));
    await userEvent.click(canvas.getByTestId("merge-confirm"));
    await userEvent.click(await canvas.findByTestId("merge-undo"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 409",
    );
    await expect(canvas.getByTestId("merge-undo")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("merge-toast-dismiss"));
    await expect(canvas.queryByTestId("merge-undo")).not.toBeInTheDocument();
  },
};

export const PartialDeleteRefetchesThePage: Story = {
  beforeEach({ msw }) {
    const both = aWireBook({
      ...BOOK,
      formats: ["EPUB", "PDF"],
      book_files: [aWireFile(), aWireFile({ id: 12, format: "PDF" })],
    });
    let reads = 0;
    msw.use(
      ...deletionHandlers(aWireManifest({ files: both.book_files }), writes),
      // The second read is the refetch, after the PDF went.
      http.get("/api/ebooks/:uuid", () =>
        HttpResponse.json(
          reads++ === 0
            ? both
            : { ...both, formats: ["EPUB"], book_files: [aWireFile()] },
        ),
      ),
      ...bookDetailHandlers(both),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("format-row-pdf");
    await userEvent.click(await canvas.findByTestId("delete-files"));
    await userEvent.click(await canvas.findByTestId("delete-file-12"));
    await userEvent.click(canvas.getByTestId("delete-continue"));
    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await waitFor(() => expect(writes).toEqual(["delete:files=12;copies="]));
    await waitFor(() =>
      expect(
        canvas.queryByTestId("delete-book-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("format-row-pdf")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("format-row-epub")).toBeInTheDocument();
  },
};

export const TotalDeleteLeavesForTheLibrary: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...deletionHandlers(aWireManifest(), writes, true),
      ...bookDetailHandlers(BOOK),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("delete-files"));
    await userEvent.click(await canvas.findByTestId("delete-select-all"));
    await userEvent.click(canvas.getByTestId("delete-continue"));
    await userEvent.click(canvas.getByTestId("delete-confirm"));

    await expect(await canvas.findByText("The library")).toBeInTheDocument();
  },
};

export const WishlistWriteRefetchesOnlyWhatItChanged: Story = {
  beforeEach({ msw }) {
    const fileless = aWireBook({ ...BOOK, formats: [], book_files: [] });
    reads.length = 0;
    msw.use(
      // Records every read, then lets the real handler answer.
      http.get("/api/*", ({ request }) => {
        reads.push(new URL(request.url).pathname);
      }),
      ...physicalHandlers({}, writes),
      ...bookDetailHandlers(fileless),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const add = await canvas.findByTestId("add-to-wishlist");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const before = reads.length;

    await userEvent.click(add);
    await canvas.findByTestId("wishlist-card");
    await new Promise((resolve) => setTimeout(resolve, 600));

    // The record, the copies and the wish, and the shelf facts that read it.
    await expect(reads.length - before).toBeLessThanOrEqual(8);
  },
};

const aliasReads: string[] = [];
const ALIAS = "00000000-0000-4000-8000-0000000000aa";

export const MergedAwayUuidMovesToTheSurvivingBook: Story = {
  parameters: { path: `/books/${ALIAS}` },
  beforeEach({ msw }) {
    aliasReads.length = 0;
    msw.use(
      // A merged-away uuid resolves to the book that absorbed it.
      http.get("/api/ebooks/:uuid", ({ params }) => {
        aliasReads.push(String(params.uuid));
        return HttpResponse.json(BOOK);
      }),
      ...bookDetailHandlers(BOOK),
    );
  },
  render: () => (
    <>
      <Routes>
        <Route path="/books/:uuid" element={<BookDetail />} />
      </Routes>
      <output data-testid="location">{useLocation().pathname}</output>
    </>
  ),
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "Aurora Station, Vol. 1" });

    await waitFor(() =>
      expect(canvas.getByTestId("location")).toHaveTextContent(
        `/books/${BOOK.unique_identifier}`,
      ),
    );
    // The survivor is seeded from the alias's answer: no second fetch, no loader.
    await expect(canvas.queryByText("Taking it off the shelf")).toBeNull();
    await expect(aliasReads).toEqual([ALIAS]);
  },
};

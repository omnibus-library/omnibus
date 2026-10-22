import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  bookDetailHandlers,
  highlightsHandlers,
  journalHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireFile,
  aWireHighlight,
  aWireJournalEntry,
  aWireOtherReview,
  aWireWishlist,
} from "../../testing/wire";
import { HighlightsJournal } from "./HighlightsJournal";
import "./BookDetail.css";
import "./BookPage.css";

const ADA = 1;

const meta = {
  title: "Pages/BookDetail/HighlightsJournal",
  component: HighlightsJournal,
  args: {
    book: toBookDetail(
      aWireBook({ formats: ["EPUB"], book_files: [aWireFile()] }),
    ),
  },
  decorators: [
    (Story) => (
      <div className="bp-root">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook()));
  },
} satisfies Meta<typeof HighlightsJournal>;

export default meta;
type Story = StoryObj<typeof meta>;

const writes: { id: number; status?: string }[] = [];

export const BothEmptyShowOneNoteWithNewEntry: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers([], ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", {
        name: "No highlights or journal entries",
      }),
    ).toBeInTheDocument();
    // One note for the pair, not a note in each column.
    await expect(canvas.queryByTestId("highlights-section")).toBeNull();
    await expect(canvas.queryByTestId("journal-section")).toBeNull();

    await userEvent.click(
      canvas.getByRole("button", { name: "New journal entry" }),
    );
    const overlay = canvas.getByTestId("journal-composer-overlay");
    await userEvent.type(
      within(overlay).getByRole("textbox", { name: "Journal entry" }),
      "First thoughts",
    );
    await userEvent.click(within(overlay).getByTestId("journal-publish"));

    // The entry is there now, so the two columns take over.
    await waitFor(() => expect(writes).toHaveLength(1));
    await expect(await canvas.findByTestId("journal-entry")).toHaveTextContent(
      "First thoughts",
    );
    await expect(canvas.getByTestId("highlights-empty")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", {
        name: "No highlights or journal entries",
      }),
    ).toBeNull();
  },
};

const PASSAGES = [
  aWireHighlight({
    id: 1,
    text: "There are maps that tell you where you are, she thought, and maps that tell you who you were when you got there.",
  }),
  aWireHighlight({ id: 2, color: "blue" }),
];

const SAYING =
  "Darrow's first night in the Institute reframes everything before it. The caste colours stop being worldbuilding and start being the plot.";

export const AWishedBookWithNoFileKeepsItsTwoNotesAndOffersNoComposer: Story = {
  args: { book: toBookDetail(aWireBook({ formats: [] })) },
  beforeEach({ msw }) {
    msw.use(
      // The wish lands after the empty reads, which a book that cannot be read still makes at first.
      http.get("/api/physical/:uuid/wishlist", async () => {
        await delay(400);
        return HttpResponse.json(aWireWishlist());
      }),
      ...highlightsHandlers([]),
      ...journalHandlers([], ADA),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("highlights-empty", undefined, {
        timeout: 3000,
      }),
    ).toHaveTextContent("Find a copy first");
    await expect(canvas.getByTestId("journal-empty")).toHaveTextContent(
      "Find a copy first",
    );
    await expect(canvas.queryByTestId("highlights-journal-empty")).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "New journal entry" }),
    ).toBeNull();
  },
};

export const HighlightsBesideTheJournal: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...highlightsHandlers(PASSAGES),
      ...journalHandlers(
        [
          aWireJournalEntry({ id: 1, progress: 62 }),
          aWireJournalEntry({
            id: 2,
            progress: 40,
            body_md: SAYING,
            body_html: `<p>${SAYING} ${SAYING}</p>`,
          }),
        ],
        ADA,
      ),
      ...reviewHandlers({
        others: [
          aWireOtherReview(),
          aWireOtherReview({ user_id: 8, username: "linus" }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Highlights 2" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("heading", { name: "Journal 2" }),
    ).toBeVisible();
    await expect(await canvas.findAllByTestId("highlight-card")).toHaveLength(
      2,
    );
    await expect(await canvas.findAllByTestId("journal-entry")).toHaveLength(2);
    await expect(await canvas.findByTestId("journal-quiet")).toHaveTextContent(
      "grace and linus rated or reviewed this book",
    );
  },
};

export const AHighlightAloneKeepsBothColumns: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers([aWireHighlight({ id: 1 })]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Highlights 1" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Journal" }),
    ).toBeVisible();
    await expect(
      await canvas.findByTestId("journal-empty"),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", {
        name: "No highlights or journal entries",
      }),
    ).toBeNull();
  },
};

export const AnEntryAloneKeepsBothColumns: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers([aWireJournalEntry()], ADA));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("journal-entry")).toBeVisible();
    await expect(await canvas.findByTestId("highlights-empty")).toBeVisible();
    await expect(
      canvas.queryByRole("heading", {
        name: "No highlights or journal entries",
      }),
    ).toBeNull();
  },
};

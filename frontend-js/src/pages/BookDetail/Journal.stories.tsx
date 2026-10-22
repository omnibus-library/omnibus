import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fn, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  bookDetailHandlers,
  failing,
  hanging,
  journalHandlers,
  physicalHandlers,
  reviewHandlers,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireJournalEntry,
  aWireOtherReview,
  aWireWishlist,
} from "../../testing/wire";
import { Journal } from "./Journal";
import "./BookDetail.css";
import "./BookPage.css";

const ADA = 1;
const GRACE = { author_id: 7, author_name: "grace" } as const;

const SPOILER_HTML =
  '<p>She <span class="spoiler" role="button" tabindex="0" aria-expanded="false" aria-label="Reveal spoiler"><span class="spoiler-text" aria-hidden="true">dies</span></span> in chapter four.</p>';

const ENTRIES = [
  aWireJournalEntry({ id: 1, progress: 42 }),
  aWireJournalEntry({
    id: 2,
    ...GRACE,
    progress: null,
    body_md: "she ||dies|| in chapter four",
    body_html: SPOILER_HTML,
  }),
  aWireJournalEntry({
    id: 3,
    status: "draft",
    body_md: "# Half a thought",
    body_html: "<h1>Half a thought</h1>",
  }),
];

const PARAGRAPH =
  "Darrow's first night in the Institute reframes everything before it. The caste colours stop being worldbuilding and start being the plot.";

/** One paragraph of several lines, where a card shows two before "Read more". */
const SAYING = Array(4).fill(PARAGRAPH).join(" ");
const LONG = aWireJournalEntry({
  id: 4,
  ...GRACE,
  progress: 80,
  body_md: SAYING,
  body_html: `<p>${SAYING}</p>`,
});

const meta = {
  title: "Pages/BookDetail/Journal",
  component: Journal,
  decorators: [
    (Story) => (
      <div className="bp-root">
        <Story />
      </div>
    ),
  ],
  args: { book: toBookDetail(aWireBook()), onCompose: fn() },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook()));
  },
} satisfies Meta<typeof Journal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The entry cards in the feed, in the order the server sent them. */
const cards = (canvas: ReturnType<typeof within>) =>
  canvas.findAllByTestId("journal-entry");

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/journals/book/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "Journal" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Gathering the entries")).toBeInTheDocument();
    await expect(canvas.queryByTestId("journal-empty")).not.toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/journals/book/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("journal-error")).toHaveTextContent(
      "The journal didn’t load",
    );
    await expect(canvas.queryByTestId("journal-empty")).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("journal-empty")).toHaveTextContent(
      "Be the first to write one",
    );
    await expect(canvas.queryByTestId("journal-count")).toBeNull();
    await expect(canvas.getByTestId("journal-open-composer")).toBeVisible();
  },
};

export const EntriesShowInlineWithReadMore: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers([...ENTRIES, LONG], ADA));
  },
  play: async ({ canvas, userEvent }) => {
    const [mine, theirs, draft, long] = (await cards(canvas)) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    await expect(canvas.getByTestId("journal-count")).toHaveTextContent("4");

    // Who, when and how far in; your own entry says so, another reader's has no position.
    await expect(mine).toHaveTextContent(
      /Ada Lovelaceyou · \w+ \d+, 2025 · at 42%/,
    );
    await expect(theirs).toHaveTextContent(/grace · \w+ \d+, 2025She/);
    await expect(
      within(draft).getByTestId("journal-draft-chip"),
    ).toBeInTheDocument();

    // A short entry has nothing to read more of.
    await expect(
      within(mine).queryByRole("button", { name: "Read more" }),
    ).toBeNull();

    // A long one shows two lines, and opens to all of it.
    const text = long.querySelector(".bp-entry-text") as HTMLElement;
    const more = await within(long).findByRole("button", {
      name: "Read more",
    });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(text.clientHeight).toBeLessThan(text.scrollHeight);
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
    await expect(text.clientHeight).toBeLessThanOrEqual(lineHeight * 2 + 1);

    await userEvent.click(more);

    await expect(more).toHaveTextContent("Show less");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(text.clientHeight).toBeGreaterThanOrEqual(text.scrollHeight);

    await userEvent.click(more);

    await expect(more).toHaveTextContent("Read more");
    await expect(text.clientHeight).toBeLessThan(text.scrollHeight);
  },
};

export const OneEntryCountsOne: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers([ENTRIES[0] as (typeof ENTRIES)[number]], ADA));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("journal-count")).toHaveTextContent(
      "1",
    );
    await expect(await cards(canvas)).toHaveLength(1);
  },
};

export const AnotherReadersDraftNeverAppears: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...journalHandlers(
        [
          ...ENTRIES,
          aWireJournalEntry({
            id: 9,
            ...GRACE,
            status: "draft",
            body_md: "grace's secret draft",
          }),
        ],
        ADA,
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await cards(canvas)).toHaveLength(3);
    await expect(
      canvas.queryByText(/grace's secret draft/),
    ).not.toBeInTheDocument();
  },
};

export const QuietReadersGetAStoatNote: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...journalHandlers(ENTRIES, ADA),
      // Grace wrote an entry; linus and maya only rated.
      ...reviewHandlers({
        others: [
          aWireOtherReview(),
          aWireOtherReview({ user_id: 8, username: "linus", stars: 3 }),
          aWireOtherReview({ user_id: 9, username: "maya", stars: 4 }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    const note = await canvas.findByTestId("journal-quiet");
    await expect(note).toHaveTextContent(
      "linus and maya rated or reviewed this book but haven't shared journal entries.",
    );
    await expect(note).not.toHaveTextContent("grace");
  },
};

export const NoNoteWhenEveryoneWrote: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...journalHandlers(ENTRIES, ADA),
      ...reviewHandlers({ others: [aWireOtherReview()] }),
    );
  },
  play: async ({ canvas }) => {
    await cards(canvas);
    await expect(canvas.queryByTestId("journal-quiet")).toBeNull();
  },
};

export const SpoilersRevealOnClickAndKey: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, userEvent }) => {
    const spoiler = await canvas.findByRole("button", {
      name: "Reveal spoiler",
    });
    await expect(spoiler).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(spoiler);

    await expect(spoiler).toHaveClass("revealed");
    await expect(spoiler).toHaveAttribute("aria-expanded", "true");
    await expect(spoiler.querySelector(".spoiler-text")).not.toHaveAttribute(
      "aria-hidden",
    );

    spoiler.focus();
    await userEvent.keyboard("{Enter}");
    await expect(spoiler).not.toHaveClass("revealed");
    await expect(spoiler).toHaveAttribute("aria-label", "Reveal spoiler");

    await userEvent.keyboard(" ");
    await expect(spoiler).toHaveClass("revealed");
  },
};

const writes: { id: number; status?: string }[] = [];

export const OwnerPublishesADraft: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[2] as HTMLElement;
    await expect(
      within(card).getByTestId("journal-draft-chip"),
    ).toBeInTheDocument();
    await expect(within(card).getByText("you")).toBeInTheDocument();

    await userEvent.click(within(card).getByTestId("journal-publish-draft"));

    await waitFor(() =>
      expect(writes).toEqual([{ id: 3, status: "published" }]),
    );
    // The feed refetches: the draft is a published entry now.
    await waitFor(() =>
      expect(canvas.queryByTestId("journal-publish-draft")).toBeNull(),
    );
    await expect(canvas.queryByTestId("journal-draft-chip")).toBeNull();
    await expect(canvas.getAllByTestId("journal-entry")).toHaveLength(3);
  },
};

export const PublishFailsKeepsTheDraft: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.patch(
        "/api/journals/:id",
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
      ...journalHandlers(ENTRIES, ADA),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[2] as HTMLElement;
    await userEvent.click(within(card).getByTestId("journal-publish-draft"));

    await expect(await within(card).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(canvas.getByTestId("journal-draft-chip")).toBeInTheDocument();
  },
};

export const OwnerDeletesAnEntry: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[0] as HTMLElement;
    await userEvent.click(within(card).getByTestId("journal-delete"));

    const dialog = canvas.getByRole("dialog", { name: "Delete entry?" });
    await expect(dialog).toHaveTextContent("This can’t be undone.");
    await userEvent.click(
      within(dialog).getByTestId("journal-delete-modal-cancel"),
    );
    await expect(writes).toEqual([]);

    await userEvent.click(within(card).getByTestId("journal-delete"));
    await userEvent.click(canvas.getByTestId("journal-delete-modal-confirm"));

    await waitFor(() => expect(writes).toEqual([{ id: 1 }]));
    await waitFor(() =>
      expect(canvas.getAllByTestId("journal-entry")).toHaveLength(2),
    );
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const DeleteFailsKeepsTheEntry: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.delete(
        "/api/journals/:id",
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
      ...journalHandlers(ENTRIES, ADA),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[0] as HTMLElement;
    await userEvent.click(within(card).getByTestId("journal-delete"));
    await userEvent.click(canvas.getByTestId("journal-delete-modal-confirm"));

    const confirm = canvas.getByRole("dialog", { name: "Delete entry?" });
    await expect(await within(confirm).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(canvas.getAllByTestId("journal-entry")).toHaveLength(3);

    // Escape closes the confirm once the failure ended the wait.
    await waitFor(() =>
      expect(confirm).toContainElement(document.activeElement as HTMLElement),
    );
    await userEvent.keyboard("{Escape}");
    await expect(confirm).not.toBeInTheDocument();
    await expect(canvas.getAllByTestId("journal-entry")).toHaveLength(3);
  },
};

export const NewEntryAsksTheTabForTheComposer: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("journal-open-composer"));

    await expect(args.onCompose).toHaveBeenCalledOnce();
  },
};

export const OwnerEditsAnEntry: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[0] as HTMLElement;
    await userEvent.click(within(card).getByTestId("journal-edit"));

    // The editor opens on the entry's markdown, and the card's own actions step aside.
    const editor = within(card).getByRole("textbox", {
      name: "Edit journal entry",
    });
    await expect(editor).toHaveTextContent("The footnotes have footnotes.");
    await expect(
      within(card).queryByTestId("journal-edit"),
    ).not.toBeInTheDocument();

    getSelection()?.selectAllChildren(editor);
    await userEvent.keyboard("Rewritten");
    await userEvent.click(within(card).getByTestId("journal-edit-save"));

    await waitFor(() => expect(writes).toEqual([{ id: 1 }]));
    // The open editor holds "Rewritten" too, so the card is read once it has closed.
    await waitFor(() =>
      expect(
        canvas.queryByRole("textbox", { name: "Edit journal entry" }),
      ).not.toBeInTheDocument(),
    );
    await expect((await cards(canvas))[0]).toHaveTextContent("Rewritten");
  },
};

export const EditCancelRestoresTheCard: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[0] as HTMLElement;
    await userEvent.click(within(card).getByTestId("journal-edit"));
    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));

    await expect(within(card).getByTestId("journal-edit")).toBeInTheDocument();
    await expect(card).toHaveTextContent("The footnotes have footnotes.");
    await expect(writes).toEqual([]);
  },
};

export const EditFailsKeepsTheEditor: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.patch(
        "/api/journals/:id",
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
      ...journalHandlers(ENTRIES, ADA),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[0] as HTMLElement;
    await userEvent.click(within(card).getByTestId("journal-edit"));
    await userEvent.click(within(card).getByTestId("journal-edit-save"));

    await expect(await within(card).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(within(card).getByTestId("journal-edit-save")).toBeEnabled();
  },
};

export const OthersEntriesOfferNoEdit: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas }) => {
    const theirs = (await cards(canvas))[1] as HTMLElement;
    await expect(theirs).toHaveTextContent("grace");
    await expect(within(theirs).queryByTestId("journal-edit")).toBeNull();
    await expect(within(theirs).queryByTestId("journal-delete")).toBeNull();
    // Ada's own two entries do.
    await expect(canvas.getAllByTestId("journal-edit")).toHaveLength(2);
  },
};

export const WishlistOnlyBookHasNoJournalYet: Story = {
  args: { book: toBookDetail(aWireBook({ formats: [] })) },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({ wishlist: aWireWishlist() }));
  },
  play: async ({ canvas }) => {
    // The wishlist read lands after the first draw, which is the empty feed's.
    await waitFor(() =>
      expect(canvas.getByTestId("journal-empty")).toHaveTextContent(
        "The journal begins when you do.",
      ),
    );
    await expect(
      canvas.queryByTestId("journal-open-composer"),
    ).not.toBeInTheDocument();
  },
};

export const EditFocusesTheEditorAndGivesFocusBack: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[0] as HTMLElement;
    const edit = within(card).getByTestId("journal-edit");
    await userEvent.click(edit);

    const editor = within(card).getByRole("textbox", {
      name: "Edit journal entry",
    });
    await waitFor(() => expect(editor).toHaveFocus());

    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));

    // The button that opened the editor is back, and focus with it.
    const back = within(card).getByTestId("journal-edit");
    await waitFor(() => expect(back).toHaveFocus());
  },
};

export const SavingAnEditGivesFocusBackToEdit: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, userEvent }) => {
    const card = (await cards(canvas))[0] as HTMLElement;
    await userEvent.click(within(card).getByTestId("journal-edit"));
    await within(card).findByRole("textbox", { name: "Edit journal entry" });

    await userEvent.click(within(card).getByTestId("journal-edit-save"));

    await waitFor(() =>
      expect(within(card).getByTestId("journal-edit")).toHaveFocus(),
    );
  },
};

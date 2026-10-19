import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import {
  bookDetailHandlers,
  failing,
  hanging,
  journalHandlers,
} from "../../testing/handlers";
import { aWireBook, aWireJournalEntry } from "../../testing/wire";
import { JournalStop } from "./JournalStop";

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

const meta = {
  title: "Pages/BookDetail/JournalStop",
  component: JournalStop,
  args: { book: toBookDetail(aWireBook()) },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook()));
  },
} satisfies Meta<typeof JournalStop>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/journals/book/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("journal-kicker")).toHaveTextContent(
      "Counting entries",
    );
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
      "No journal entries yet — be the first to write one.",
    );
    await expect(canvas.getByTestId("journal-kicker")).toHaveTextContent(
      "No entries yet",
    );
  },
};

export const Ladder: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("journal-kicker")).toHaveTextContent(
        "2 entries from 2 readers · 1 draft",
      ),
    );
    const [mine, theirs, draft] = canvas.getAllByTestId("journal-ladder-row");
    await expect(mine).toHaveTextContent("Ada Lovelace· you");
    await expect(mine).toHaveTextContent(/· at 42%/);
    await expect(mine).toHaveTextContent(
      "The footnotes have footnotes. read →",
    );
    await expect(theirs).not.toHaveTextContent("you");
    await expect(theirs).not.toHaveTextContent(/at \d+%/);
    // The always-visible row masks a spoiler rather than printing it.
    await expect(theirs).toHaveTextContent("she ███ in chapter four read →");
    await expect(
      within(draft as HTMLElement).getByTestId("journal-draft-chip-row"),
    ).toBeInTheDocument();
    await expect(draft).toHaveClass("draft");
    await expect(
      canvasElement.querySelector(".bdmq-avatarstack"),
    ).toHaveAttribute("aria-hidden", "true");
  },
};

export const OneReaderHasNoAvatarStack: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers([ENTRIES[0] as (typeof ENTRIES)[number]], ADA));
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("journal-kicker")).toHaveTextContent(
        "1 entry from 1 reader",
      ),
    );
    await expect(canvasElement.querySelector(".bdmq-avatarstack")).toBeNull();
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
    await expect(
      await canvas.findAllByTestId("journal-ladder-row"),
    ).toHaveLength(3);
    await expect(
      canvas.queryByText(/grace's secret draft/),
    ).not.toBeInTheDocument();
  },
};

export const OpensTheFullCard: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[1] as HTMLElement,
    );

    const overlay = canvas.getByTestId("journal-overlay");
    const card = within(overlay).getByTestId("journal-entry");
    await expect(card).toHaveTextContent("grace");
    await expect(card).toHaveTextContent("She dies in chapter four.");
    // Not Ada's entry: no actions.
    await expect(
      within(card).queryByTestId("journal-delete"),
    ).not.toBeInTheDocument();

    await userEvent.click(within(overlay).getByTestId("journal-overlay-close"));
    await expect(
      canvas.queryByTestId("journal-overlay"),
    ).not.toBeInTheDocument();

    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[1] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("journal-entry"));
    await expect(canvas.getByTestId("journal-overlay")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("journal-overlay"));
    await expect(
      canvas.queryByTestId("journal-overlay"),
    ).not.toBeInTheDocument();
  },
};

export const SpoilersRevealOnClickAndKey: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[1] as HTMLElement,
    );
    const spoiler = canvas.getByRole("button", { name: "Reveal spoiler" });
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
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[2] as HTMLElement,
    );
    const card = canvas.getByTestId("journal-entry");
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
      expect(canvas.getByTestId("journal-kicker")).toHaveTextContent(
        "3 entries from 2 readers",
      ),
    );
    await expect(
      canvas.queryByTestId("journal-publish-draft"),
    ).not.toBeInTheDocument();
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
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[2] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("journal-publish-draft"));

    await expect(
      await within(canvas.getByTestId("journal-entry")).findByRole("alert"),
    ).toHaveTextContent("failed with 500");
    await expect(canvas.getByTestId("journal-draft-chip")).toBeInTheDocument();
    await expect(canvas.getByTestId("journal-kicker")).toHaveTextContent(
      "· 1 draft",
    );
  },
};

export const OwnerDeletesAnEntry: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("journal-delete"));

    const dialog = canvas.getByRole("dialog", { name: "Delete entry?" });
    await expect(dialog).toHaveTextContent("This can’t be undone.");
    await userEvent.click(
      within(dialog).getByTestId("journal-delete-modal-cancel"),
    );
    await expect(writes).toEqual([]);

    await userEvent.click(canvas.getByTestId("journal-delete"));
    await userEvent.click(canvas.getByTestId("journal-delete-modal-confirm"));

    await waitFor(() => expect(writes).toEqual([{ id: 1 }]));
    await waitFor(() =>
      expect(canvas.getAllByTestId("journal-ladder-row")).toHaveLength(2),
    );
    await expect(
      canvas.queryByTestId("journal-overlay"),
    ).not.toBeInTheDocument();
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
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("journal-delete"));
    await userEvent.click(canvas.getByTestId("journal-delete-modal-confirm"));

    await expect(
      await within(canvas.getByRole("dialog")).findByRole("alert"),
    ).toHaveTextContent("failed with 500");
    await expect(canvas.getAllByTestId("journal-ladder-row")).toHaveLength(3);
  },
};

export const NewEntryPublishesIntoTheFeed: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("journal-open-composer"));
    const overlay = canvas.getByTestId("journal-composer-overlay");
    await userEvent.type(
      within(overlay).getByRole("textbox", { name: "Journal entry" }),
      "A fresh thought",
    );
    await userEvent.click(within(overlay).getByTestId("journal-publish"));

    await waitFor(() =>
      expect(writes).toEqual([{ id: 100, status: "published" }]),
    );
    await waitFor(() =>
      expect(canvas.getAllByTestId("journal-ladder-row")).toHaveLength(4),
    );
    await expect(canvas.getByTestId("journal-kicker")).toHaveTextContent(
      "3 entries from 2 readers · 1 draft",
    );
    await expect(
      canvas.queryByTestId("journal-composer-overlay"),
    ).not.toBeInTheDocument();
  },
};

export const ComposerIgnoresAClickOutside: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("journal-open-composer"));
    await userEvent.click(canvas.getByTestId("journal-composer-overlay"));
    await expect(canvas.getByTestId("journal-composer")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        canvas.queryByTestId("journal-composer-overlay"),
      ).not.toBeInTheDocument(),
    );
  },
};

export const OwnerEditsAnEntry: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[0] as HTMLElement,
    );
    const card = canvas.getByTestId("journal-entry");
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
    await waitFor(() =>
      expect(canvas.getByTestId("journal-entry")).toHaveTextContent(
        "Rewritten",
      ),
    );
    await expect(
      canvas.queryByRole("textbox", { name: "Edit journal entry" }),
    ).not.toBeInTheDocument();
  },
};

export const EditCancelRestoresTheCard: Story = {
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(...journalHandlers(ENTRIES, ADA, writes));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("journal-edit"));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await expect(canvas.getByTestId("journal-edit")).toBeInTheDocument();
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
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByTestId("journal-edit"));
    await userEvent.click(canvas.getByTestId("journal-edit-save"));

    await expect(
      await within(canvas.getByTestId("journal-entry")).findByRole("alert"),
    ).toHaveTextContent("failed with 500");
    await expect(canvas.getByTestId("journal-edit-save")).toBeEnabled();
  },
};

export const OthersEntriesOfferNoEdit: Story = {
  beforeEach({ msw }) {
    msw.use(...journalHandlers(ENTRIES, ADA));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (await canvas.findAllByTestId("journal-ladder-row"))[1] as HTMLElement,
    );
    await expect(canvas.queryByTestId("journal-edit")).not.toBeInTheDocument();
  },
};

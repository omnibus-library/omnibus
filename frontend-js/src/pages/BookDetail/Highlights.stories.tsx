import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fn, waitFor, within } from "storybook/test";
import { toBookDetail } from "../../api";
import { getGetAlignmentMockHandler200 } from "../../api/generated/omnibus.msw";
import {
  bookDetailHandlers,
  failing,
  hanging,
  highlightsHandlers,
  physicalHandlers,
} from "../../testing/handlers";
import {
  aWireAlignment,
  aWireBook,
  aWireFile,
  aWireHighlight,
  aWireWishlist,
} from "../../testing/wire";
import { Highlights } from "./Highlights";
import "./BookDetail.css";
import "./BookPage.css";

const UUID = "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0";

const PASSAGES = [
  aWireHighlight({ id: 1, note: "Remember this one." }),
  aWireHighlight({
    id: 2,
    color: "blue",
    text: "The crew must decide whether to reply.",
    epub_cfi_range: "pdf:3:72.0,710.2,172.0,710.2,72.0,700.0,172.0,700.0",
  }),
];

const meta = {
  title: "Pages/BookDetail/Highlights",
  component: Highlights,
  decorators: [
    (Story) => (
      <div className="bp-root">
        <Story />
      </div>
    ),
  ],
  args: {
    book: toBookDetail(
      aWireBook({ formats: ["EPUB"], book_files: [aWireFile()] }),
    ),
  },
  beforeEach({ msw }) {
    msw.use(
      getGetAlignmentMockHandler200(
        aWireAlignment({
          ebook: {
            total_chars: 100,
            chapters: [
              { title: "Front matter", percent: 0, spine_index: 0 },
              { title: "Chapter One", percent: 10, spine_index: 2 },
            ],
          },
        }),
      ),
      ...bookDetailHandlers(aWireBook()),
    );
  },
} satisfies Meta<typeof Highlights>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/highlights/book/:uuid"));
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "Highlights" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Finding your passages")).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("highlights-empty"),
    ).not.toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/highlights/book/:uuid", 500));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("highlights-error"),
    ).toHaveTextContent("Your saved passages didn’t load");
    await expect(
      canvas.queryByTestId("highlights-empty"),
    ).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("highlights-empty"),
    ).toHaveTextContent(
      "No highlights yetHighlight while you read to keep passages here.",
    );
    await expect(canvas.queryByTestId("highlights-count")).toBeNull();
  },
};

export const Passages: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers(PASSAGES));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Highlights 2" }),
    ).toBeInTheDocument();
    const [first, second] = canvas.getAllByTestId("highlight-card");
    await expect(first).toHaveAttribute("data-color", "amber");
    // The share face repeats the passage, so the front is read on its own.
    await expect(
      within(
        within(first as HTMLElement).getByTestId("highlight-front"),
      ).getByText("A station at the edge of the map hears something answer."),
    ).toBeInTheDocument();
    await expect(
      within(first as HTMLElement).getByTestId("highlight-note"),
    ).toHaveTextContent("Remember this one.");
    await waitFor(() =>
      expect(
        within(first as HTMLElement).getByTestId("highlight-meta"),
      ).toHaveTextContent(/^Chapter One · \w+ \d+, 2025$/),
    );
    await expect(
      within(second as HTMLElement).getByTestId("highlight-meta"),
    ).toHaveTextContent(/^Chapter One · /);
  },
};

export const OpensTheReaderAtThePassage: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers(PASSAGES));
  },
  play: async ({ canvas }) => {
    const links = await canvas.findAllByRole("link", {
      name: "Open in book",
    });

    await expect(links[0]).toHaveAttribute(
      "href",
      `/read/${UUID}?cfi=epubcfi%28%2F6%2F6%21%2F4%2F2%2C%2F1%3A0%2C%2F1%3A20%29`,
    );
    await expect(links[1]).toHaveAttribute("href", `/pdf/${UUID}?page=4`);
  },
};

export const WithoutAnAnchor: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers([aWireHighlight({ epub_cfi_range: null })]));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("highlight-meta")).toHaveTextContent(
      /^\w+ \d+, 2025$/,
    );
    await expect(
      canvas.queryByRole("link", { name: "Open in book" }),
    ).not.toBeInTheDocument();
  },
};

export const WithoutText: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers([aWireHighlight({ text: null })]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("(highlighted passage)"),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Copy" })).toBeDisabled();
  },
};

export const CopiesThePassage: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers([PASSAGES[0] as (typeof PASSAGES)[number]]));
    // The real clipboard needs a focused document, which a test page isn't.
    const original = navigator.clipboard;
    const writeText = fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return () =>
      Object.defineProperty(navigator, "clipboard", {
        value: original,
        configurable: true,
      });
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Copy" }));

    await expect(
      await canvas.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    await expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "A station at the edge of the map hears something answer.",
    );
  },
};

const PIRANESI = toBookDetail(
  aWireBook({
    formats: ["EPUB"],
    book_files: [aWireFile()],
    title: "Piranesi",
    creators: [{ name: "Susanna Clarke" }],
  }),
);

/** The first card, with its two faces and the box they turn in. */
const firstCard = async (canvas: ReturnType<typeof within>) => {
  const card = (await canvas.findAllByTestId("highlight-card"))[0];
  const scope = within(card as HTMLElement);
  return {
    card: card as HTMLElement,
    scope,
    front: scope.getByTestId("highlight-front"),
    back: scope.getByTestId("highlight-back"),
  };
};

export const MakeQuoteCardFlipsToTheShareFace: Story = {
  args: { book: PIRANESI },
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers(PASSAGES));
  },
  play: async ({ canvas, userEvent }) => {
    const { card, scope, front, back } = await firstCard(canvas);
    await expect(front).not.toHaveAttribute("inert");
    await expect(back).toHaveAttribute("inert");

    await userEvent.click(
      scope.getByRole("button", { name: "Make quote card" }),
    );

    // The share face is the live one; the front can neither be tabbed to nor read.
    await expect(front).toHaveAttribute("inert");
    await expect(back).not.toHaveAttribute("inert");
    await expect(
      scope.getByRole("button", { name: "Flip back" }),
    ).toHaveFocus();
    await expect(back).toHaveTextContent(
      "A station at the edge of the map hears something answer.",
    );
    await expect(back).toHaveTextContent("Piranesi · Susanna Clarke");
    // The turn takes 720 ms and ends facing away from the front.
    const inner = card.querySelector(".bp-quote-inner") as HTMLElement;
    await waitFor(
      () => expect(getComputedStyle(inner).transform).toMatch(/^matrix3d\(-1,/),
      { timeout: 3000 },
    );
    // The other card stays as it was.
    await expect(
      within(
        canvas.getAllByTestId("highlight-card")[1] as HTMLElement,
      ).getByTestId("highlight-back"),
    ).toHaveAttribute("inert");
  },
};

export const FlipBackReturnsToTheFront: Story = {
  args: { book: PIRANESI },
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers(PASSAGES));
  },
  play: async ({ canvas, userEvent }) => {
    const { scope, front, back } = await firstCard(canvas);
    await userEvent.click(
      scope.getByRole("button", { name: "Make quote card" }),
    );

    await userEvent.click(scope.getByRole("button", { name: "Flip back" }));

    await expect(front).not.toHaveAttribute("inert");
    await expect(back).toHaveAttribute("inert");
    await expect(
      scope.getByRole("button", { name: "Make quote card" }),
    ).toHaveFocus();
  },
};

export const SaveImageOpensTheQuoteCardEditor: Story = {
  args: { book: PIRANESI },
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers(PASSAGES));
  },
  play: async ({ canvas, userEvent }) => {
    const { scope } = await firstCard(canvas);
    await userEvent.click(
      scope.getByRole("button", { name: "Make quote card" }),
    );
    const save = scope.getByRole("button", { name: "Save image…" });

    await userEvent.click(save);

    const dialog = canvas.getByRole("dialog", { name: "Make a quote card" });
    await expect(
      within(dialog).getByTestId("quote-preview-body"),
    ).toHaveTextContent(
      "“A station at the edge of the map hears something answer.”",
    );
    await expect(
      within(dialog).getByText("Susanna Clarke"),
    ).toBeInTheDocument();
    await expect(within(dialog).getByText("Piranesi")).toBeInTheDocument();
    await waitFor(() => expect(dialog).toHaveFocus());

    await userEvent.keyboard("{Escape}");

    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    // The card is still turned over, and focus is back where it left.
    await waitFor(() => expect(save).toHaveFocus());
  },
};

export const QuoteCardNeedsText: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers([aWireHighlight({ text: null })]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Make quote card" }),
    ).toBeDisabled();
  },
};

const deleted: number[] = [];

export const DeleteWaitsForTheServer: Story = {
  beforeEach({ msw }) {
    deleted.length = 0;
    msw.use(...highlightsHandlers(PASSAGES, deleted));
  },
  play: async ({ canvas, userEvent }) => {
    const [firstDelete] = await canvas.findAllByRole("button", {
      name: "Delete highlight",
    });

    await userEvent.click(firstDelete as HTMLElement);
    const dialog = canvas.getByRole("dialog", { name: "Delete this passage?" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(deleted).toEqual([]);

    await userEvent.click(
      canvas.getAllByRole("button", {
        name: "Delete highlight",
      })[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toEqual([1]));
    await expect(
      await canvas.findByRole("heading", { name: "Highlights 1" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(canvas.getAllByTestId("highlight-card")).toHaveLength(1);
  },
};

export const DeleteFailureKeepsTheRow: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.delete(
        "/api/highlights/:id",
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
      ...highlightsHandlers(PASSAGES),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (
        await canvas.findAllByRole("button", { name: "Delete highlight" })
      )[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t delete the passage: failed with 500",
    );
    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
    await expect(canvas.getAllByTestId("highlight-card")).toHaveLength(2);

    // The failure ended the wait, so the dialog can be dismissed again.
    const dialog = canvas.getByRole("dialog");
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

export const DeleteInFlightIgnoresEscape: Story = {
  beforeEach({ msw }) {
    msw.use(
      hanging("/api/highlights/:id", "delete"),
      ...highlightsHandlers(PASSAGES),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      (
        await canvas.findAllByRole("button", { name: "Delete highlight" })
      )[0] as HTMLElement,
    );
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    await expect(
      await canvas.findByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();

    // Aim at the dialog itself: a disabled button takes the keys of nobody.
    canvas.getByRole("dialog").focus();
    await userEvent.keyboard("{Escape}");

    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const WishlistOnlyBookKeepsNoLines: Story = {
  args: { book: toBookDetail(aWireBook({ formats: [] })) },
  beforeEach({ msw }) {
    msw.use(...physicalHandlers({ wishlist: aWireWishlist() }));
  },
  play: async ({ canvas }) => {
    // The wishlist read lands after the first draw, which is the empty feed's.
    await waitFor(() =>
      expect(canvas.getByTestId("highlights-empty")).toHaveTextContent(
        "Highlight while you read to keep lines here.",
      ),
    );
    await expect(
      canvas.queryByTestId("highlights-section"),
    ).not.toBeInTheDocument();
  },
};

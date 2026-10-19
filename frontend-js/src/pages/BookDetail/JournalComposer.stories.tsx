import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fn, waitFor } from "storybook/test";
import { parseBookUuid } from "../../api";
import { PostJournalBody } from "../../api/generated/schemas";
import {
  failing,
  highlightsHandlers,
  journalHandlers,
} from "../../testing/handlers";
import { aWireHighlight, aWireJournalEntry } from "../../testing/wire";
import { JournalComposer } from "./JournalComposer";

const ADA = 1;
const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");
if (!UUID) throw new Error("fixture uuid");

const writes: { id: number; status?: string }[] = [];

const meta = {
  title: "Pages/BookDetail/JournalComposer",
  component: JournalComposer,
  args: { uuid: UUID, onClose: fn() },
  beforeEach({ msw }) {
    writes.length = 0;
    msw.use(
      ...journalHandlers([], ADA, writes),
      ...highlightsHandlers([
        aWireHighlight({ id: 5, text: "A held breath." }),
      ]),
    );
  },
} satisfies Meta<typeof JournalComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blank: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("textbox", { name: "Journal entry" }),
    ).toHaveTextContent("");
    await expect(canvas.getByTestId("journal-save-draft")).toBeDisabled();
    await expect(canvas.getByTestId("journal-publish")).toBeDisabled();
    await expect(canvas.getByTestId("journal-spoiler-help")).toHaveTextContent(
      "Spoilers? Wrap text in ||double pipes||",
    );
  },
};

export const PublishesTheEntry: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "Loved the *ending*",
    );
    await userEvent.click(canvas.getByTestId("journal-publish"));

    await waitFor(() =>
      expect(writes).toEqual([{ id: 100, status: "published" }]),
    );
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

export const SavesADraft: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "Half a thought",
    );
    await userEvent.click(canvas.getByTestId("journal-save-draft"));

    await waitFor(() => expect(writes).toEqual([{ id: 100, status: "draft" }]));
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

export const AutosavesThenPublishesTheSameDraft: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "Typing away",
    );

    // Two seconds after the last keystroke the first save creates a draft.
    await expect(
      await canvas.findByTestId("journal-autosaved", {}, { timeout: 5000 }),
    ).toHaveTextContent("Auto-saved just now");
    await expect(writes).toEqual([{ id: 100, status: "draft" }]);
    // The indicator ticks every five seconds.
    await expect(
      await canvas.findByText("Auto-saved 5s ago", {}, { timeout: 8000 }),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("journal-publish"));
    await waitFor(() =>
      expect(writes).toEqual([
        { id: 100, status: "draft" },
        { id: 100, status: "published" },
      ]),
    );
  },
};

export const CancelDiscardsTheAutosavedDraft: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "Never mind",
    );
    await canvas.findByTestId("journal-autosaved", {}, { timeout: 5000 });

    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
    await expect(writes).toEqual([{ id: 100, status: "draft" }, { id: 100 }]);
  },
};

export const CancelWithNothingSavedWritesNothing: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "x",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
    await expect(writes).toEqual([]);
  },
};

export const SaveFailsKeepsTheComposerOpen: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/journals", 500));
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "Lost?",
    );
    await userEvent.click(canvas.getByTestId("journal-publish"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(canvas.getByTestId("journal-publish")).toBeEnabled();
  },
};

export const PreviewShowsTheServersHtml: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "hello",
    );
    await userEvent.click(canvas.getByTestId("journal-preview-toggle"));

    await expect(
      await canvas.findByTestId("journal-preview"),
    ).toHaveTextContent("hello");
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Write" }));
    await expect(
      canvas.getByRole("textbox", { name: "Journal entry" }),
    ).toHaveTextContent("hello");
  },
};

export const PreviewFailureIsShown: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/journals/preview", 400));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "hello",
    );
    await userEvent.click(canvas.getByTestId("journal-preview-toggle"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Preview failed: failed with 400",
    );
  },
};

export const ToolbarWrapsTheSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "Journal entry" });
    await userEvent.type(editor, "word");
    getSelection()?.selectAllChildren(editor);

    await userEvent.click(canvas.getByRole("button", { name: "Bold" }));

    await expect(editor).toHaveTextContent("**word**");
    await expect(canvas.getByTestId("journal-publish")).toBeEnabled();
  },
};

export const ToolbarWorksWithNoSelectionRange: Story = {
  play: async ({ canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "Journal entry" });
    await userEvent.type(editor, "word");
    getSelection()?.removeAllRanges();

    await userEvent.click(canvas.getByRole("button", { name: "Bold" }));

    await expect(editor.textContent).toContain("****");
  },
};

export const EnterInsertsALineBreakAndDecoratesTheLine: Story = {
  play: async ({ canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "Journal entry" });
    await userEvent.type(editor, "# Title{Enter}body");

    await expect(editor.textContent).toBe("# Title\nbody");
    await expect(editor.querySelectorAll(":scope > .cm-line")).toHaveLength(2);
    await expect(editor.querySelector(".cm-h1")).not.toBeNull();
  },
};

export const HighlightsPopoverInsertsAQuote: Story = {
  play: async ({ canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "Journal entry" });
    await userEvent.type(editor, "Thinking");
    await userEvent.click(canvas.getByTestId("journal-insert-highlight"));

    await userEvent.click(await canvas.findByTestId("journal-highlight-item"));

    await expect(editor.textContent).toContain("> A held breath.");
    await expect(editor.textContent).toContain("> — saved from highlights");
    await expect(
      canvas.queryByTestId("journal-highlights-pop"),
    ).not.toBeInTheDocument();
  },
};

export const HighlightsPopoverWithoutPassages: Story = {
  beforeEach({ msw }) {
    msw.use(...highlightsHandlers([]));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("journal-insert-highlight"));

    await expect(
      await canvas.findByTestId("journal-highlights-pop"),
    ).toHaveTextContent("No saved highlights for this book yet.");
  },
};

const posted: { progress?: number | null }[] = [];

export const ProgressRidesAlongWithTheEntry: Story = {
  beforeEach({ msw }) {
    posted.length = 0;
    msw.use(
      http.post("/api/journals", async ({ request }) => {
        posted.push(PostJournalBody.parse(await request.json()));
        return HttpResponse.json(aWireJournalEntry({ id: 100 }));
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Journal entry" }),
      "Halfway",
    );
    await expect(
      canvas.queryByTestId("journal-progress"),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("checkbox"));
    await expect(canvas.getByTestId("journal-progress")).toHaveValue("50");
    await expect(canvas.getByText("50%")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("journal-publish"));

    await waitFor(() => expect(posted).toHaveLength(1));
    await expect(posted[0]?.progress).toBe(50);
  },
};

export const ImageUploadInsertsAMarkdownImage: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post("/api/journals/images", () =>
        HttpResponse.json({ url: "/api/journals/images/map.png" }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "Journal entry" });
    await userEvent.type(editor, "See the map");

    await userEvent.upload(
      canvas.getByTestId("journal-image-input"),
      new File(["png"], "map.png", { type: "image/png" }),
    );

    await waitFor(() =>
      expect(editor.textContent).toContain(
        "![Add a caption](/api/journals/images/map.png)",
      ),
    );
  },
};

export const ImageUploadRefusedShowsTheServersMessage: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/journals/images",
        () => new HttpResponse("not an image", { status: 415 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      canvas.getByTestId("journal-image-input"),
      new File(["x"], "notes.png", { type: "image/png" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "not an image",
    );
  },
};

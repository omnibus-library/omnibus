import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fn, waitFor, within } from "storybook/test";
import { parseBookUuid, toReview } from "../../api";
import { highlightsHandlers } from "../../testing/handlers";
import { aWireHighlight, aWireReview } from "../../testing/wire";
import { ReviewComposer } from "./ReviewComposer";
// The page brings the composer's styles.
import "./BookDetail.css";

const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");
if (!UUID) throw new Error("fixture uuid");

const WRITTEN = toReview(
  aWireReview({
    body_md: "A slow burn that pays off.",
    body_html: "<p>A slow burn that pays off.</p>",
    notes_md: "Lend to Sam.",
    notes_html: "<p>Lend to Sam.</p>",
    spoiler: true,
  }),
);

const meta = {
  title: "Pages/BookDetail/ReviewComposer",
  component: ReviewComposer,
  args: {
    uuid: UUID,
    mine: null,
    onSave: fn(async () => {}),
    onClose: fn(),
  },
  beforeEach({ msw }) {
    msw.use(
      ...highlightsHandlers([
        aWireHighlight({ id: 5, text: "A held breath." }),
      ]),
    );
  },
} satisfies Meta<typeof ReviewComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewReview: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("textbox", { name: "Review text" }),
    ).toHaveTextContent("");
    await expect(canvas.getByTestId("review-body-field")).toHaveTextContent(
      "Spoilers? Wrap text in ||double pipes||",
    );
    await expect(canvas.getByTestId("review-notes-field")).toHaveTextContent(
      "only you can see these",
    );
    // The spoiler flag sits under the public field, unticked for a new review.
    await expect(
      canvas.getByRole("checkbox", { name: "Contains spoilers" }),
    ).not.toBeChecked();
  },
};

export const SavesTheSpoilerFlagWithTheText: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Review text" }),
      "Rosebud was the sled.",
    );
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Contains spoilers" }),
    );

    await userEvent.click(canvas.getByTestId("review-save"));

    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith({
        bodyMd: "Rosebud was the sled.",
        spoiler: true,
      }),
    );
  },
};

export const AFlagOnlyChangeIsSaved: Story = {
  args: { mine: WRITTEN },
  play: async ({ args, canvas, userEvent }) => {
    const box = canvas.getByRole("checkbox", { name: "Contains spoilers" });
    // Seeded from the saved review.
    await expect(box).toBeChecked();

    await userEvent.click(box);
    await userEvent.click(canvas.getByTestId("review-save"));

    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith({ spoiler: false }),
    );
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

export const SavesTextAndNotesTogether: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Review text" }),
      "Rosebud was the sled.",
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Private notes" }),
      "Reread in spring.",
    );

    await userEvent.click(canvas.getByTestId("review-save"));

    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith({
        bodyMd: "Rosebud was the sled.",
        notesMd: "Reread in spring.",
      }),
    );
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

export const EditingSendsOnlyWhatChanged: Story = {
  args: { mine: WRITTEN },
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      canvas.getByRole("textbox", { name: "Review text" }),
    ).toHaveTextContent("A slow burn that pays off.");

    await userEvent.type(
      canvas.getByRole("textbox", { name: "Private notes" }),
      " Or Jo.",
    );
    await userEvent.click(canvas.getByTestId("review-save"));

    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith({
        notesMd: "Lend to Sam. Or Jo.",
      }),
    );
  },
};

export const SavingNothingChangedJustCloses: Story = {
  args: { mine: WRITTEN },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("review-save"));

    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

export const ClearingTheTextClearsIt: Story = {
  args: { mine: WRITTEN },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.clear(canvas.getByRole("textbox", { name: "Review text" }));
    await userEvent.click(canvas.getByTestId("review-save"));

    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith({ bodyMd: null }),
    );
  },
};

export const ARefusedSaveKeepsTheDraft: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error("failed with 500");
    }),
  },
  play: async ({ args, canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "Review text" });
    await userEvent.type(editor, "Keep me.");
    await userEvent.click(canvas.getByTestId("review-save"));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(editor).toHaveTextContent("Keep me.");
    await expect(canvas.getByTestId("review-save")).toBeEnabled();
  },
};

export const InsertsAHighlightIntoTheFieldItBelongsTo: Story = {
  play: async ({ canvas, userEvent }) => {
    const notes = canvas.getByTestId("review-notes-field");
    await userEvent.click(
      within(notes).getByTestId("journal-insert-highlight"),
    );
    await userEvent.click(
      await within(notes).findByTestId("journal-highlight-item"),
    );

    await expect(
      within(notes).getByRole("textbox", { name: "Private notes" }).textContent,
    ).toContain("> A held breath.");
    await expect(
      canvas.getByRole("textbox", { name: "Review text" }),
    ).toHaveTextContent("");
  },
};

export const ImageUploadGoesIntoTheReview: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post("/api/journals/images", () =>
        HttpResponse.json({ url: "/api/journals/images/map.png" }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const review = canvas.getByTestId("review-body-field");
    const editor = within(review).getByRole("textbox", { name: "Review text" });
    await userEvent.type(editor, "See the map");

    await userEvent.upload(
      within(review).getByTestId("journal-image-input"),
      new File(["png"], "map.png", { type: "image/png" }),
    );

    await waitFor(() =>
      expect(editor.textContent).toContain(
        "![Add a caption](/api/journals/images/map.png)",
      ),
    );
  },
};

export const CancelClosesWithoutSaving: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Review text" }),
      "Never mind",
    );
    await userEvent.click(canvas.getByTestId("review-cancel"));

    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

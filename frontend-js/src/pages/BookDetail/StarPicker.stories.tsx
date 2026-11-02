import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { StarPicker } from "./StarPicker";
import "./BookDetail.css";
import "./BookPage.css";

const meta = {
  title: "Pages/BookDetail/StarPicker",
  component: StarPicker,
  args: { stars: 3, onPick: fn(), note: "You rated it 3" },
  decorators: [
    (Story) => (
      <div className="bp-root">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StarPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ArrowKeysCommitTheHalfTheyMoveTo: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const rated = canvas.getByRole("button", {
      name: "Clear your 3-star rating",
    });
    rated.focus();

    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onPick).toHaveBeenLastCalledWith(3.5);

    // The saved value has not caught up, so this arrow lands on it: a key rates, it never clears.
    await userEvent.keyboard("{ArrowLeft}");
    await expect(args.onPick).toHaveBeenLastCalledWith(3);
    await expect(args.onPick).not.toHaveBeenCalledWith(null);
  },
};

export const ClickingTheSavedValueClears: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Clear your 3-star rating" }),
    );

    await expect(args.onPick).toHaveBeenCalledWith(null);
  },
};

// A preview that resized the note reflowed the hero, moving the stars from under a still pointer, forever.
export const HoverPreviewsKeepTheNoteOneSize: Story = {
  // Narrow heroes centre their text; the note must still hug its words at the slot's start.
  decorators: [
    (Story) => (
      <div style={{ textAlign: "center" }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas, userEvent }) => {
    const note = canvas.getByTestId("review-stars-meta");
    // The slot is the box that takes layout space; the note inside it is only as wide as its words.
    const slot = canvas.getByTestId("review-stars-meta-slot");
    const size = () => {
      const { width, height } = slot.getBoundingClientRect();
      return { width, height };
    };
    const expectNoteAtStart = async () => {
      const box = note.getBoundingClientRect();
      await expect(box.left).toBe(slot.getBoundingClientRect().left);
      return box.width;
    };
    // Laying out first requests the web font; only then does `ready` wait for it to swap in.
    size();
    await document.fonts.ready;
    const resting = size();
    // The resting line is shorter than the widest, so a note stretched across the slot shows here.
    await expect(await expectNoteAtStart()).toBeLessThan(resting.width);

    await userEvent.hover(
      canvas.getByRole("button", { name: "Rate 3.5 stars" }),
    );
    await expect(note).toHaveTextContent("Rate 3.5");
    await expect(size()).toEqual(resting);
    await expect(await expectNoteAtStart()).toBeLessThan(resting.width);

    await userEvent.hover(
      canvas.getByRole("button", { name: "Clear your 3-star rating" }),
    );
    await expect(note).toHaveTextContent("Clear your rating");
    await expect(size()).toEqual(resting);
    await expectNoteAtStart();
  },
};

export const DisabledStarsTakeNoPick: Story = {
  args: { stars: null, disabled: true, note: "Loading your rating…" },
  play: async ({ args, canvas, userEvent }) => {
    const first = canvas.getByRole("button", { name: "Rate 0.5 stars" });
    await expect(first).toBeDisabled();

    await userEvent.click(first);

    await expect(args.onPick).not.toHaveBeenCalled();
  },
};

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

export const DisabledStarsTakeNoPick: Story = {
  args: { stars: null, disabled: true, note: "Loading your rating…" },
  play: async ({ args, canvas, userEvent }) => {
    const first = canvas.getByRole("button", { name: "Rate 0.5 stars" });
    await expect(first).toBeDisabled();

    await userEvent.click(first);

    await expect(args.onPick).not.toHaveBeenCalled();
  },
};

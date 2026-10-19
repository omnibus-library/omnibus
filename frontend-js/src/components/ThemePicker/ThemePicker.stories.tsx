import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ThemePicker } from "./ThemePicker";

const meta = {
  title: "Components/ThemePicker",
  component: ThemePicker,
} satisfies Meta<typeof ThemePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnDark: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("button", { name: "Sepia" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  },
};

export const Picking: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Sepia" }));

    await expect(canvas.getByRole("button", { name: "Sepia" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};

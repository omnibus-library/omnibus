import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { scorePassword } from "../../password";
import { StrengthMeter } from "./StrengthMeter";

const meta = {
  title: "Components/StrengthMeter",
  component: StrengthMeter,
} satisfies Meta<typeof StrengthMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { strength: scorePassword("") },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("At least 10 characters"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("empty")).toBeInTheDocument();
  },
};

export const Strong: Story = {
  args: { strength: scorePassword("AbCdEfGh1!2x") },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("meter", { name: "Password strength" }),
    ).toHaveAttribute("aria-valuenow", "4");
  },
};

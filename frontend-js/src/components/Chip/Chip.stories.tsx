import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Chip } from "./Chip";

const meta = {
  title: "Components/Chip",
  component: Chip,
  args: { children: "Space opera" },
  argTypes: { tone: { control: "inline-radio", options: ["plain", "genre"] } },
  decorators: [
    (Story) => (
      <ul style={{ display: "flex", gap: 8, listStyle: "none" }}>
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("listitem")).toHaveTextContent("Space opera");
  },
};

export const Genre: Story = {
  args: { tone: "genre", children: "Science fiction" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("listitem")).toHaveAttribute(
      "class",
      "chip chip-genre",
    );
  },
};

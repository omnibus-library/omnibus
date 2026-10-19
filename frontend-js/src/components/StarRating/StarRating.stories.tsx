import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { StarRating } from "./StarRating";

const meta = {
  title: "Components/StarRating",
  component: StarRating,
  args: { stars: 4.5 },
} satisfies Meta<typeof StarRating>;

export default meta;
type Story = StoryObj<typeof meta>;

const widths = (canvas: HTMLElement) =>
  [...canvas.querySelectorAll<HTMLElement>(".star-fg")].map(
    (fg) => fg.style.width,
  );

export const HalfStar: Story = {
  play: async ({ canvasElement, canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "4.5 out of 5 stars" }),
    ).toBeInTheDocument();
    await expect(widths(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "100%",
      "50%",
    ]);
  },
};

export const WholeStars: Story = {
  args: { stars: 3 },
  play: async ({ canvasElement, canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "3 out of 5 stars" }),
    ).toBeInTheDocument();
    await expect(widths(canvasElement)).toEqual([
      "100%",
      "100%",
      "100%",
      "0%",
      "0%",
    ]);
  },
};

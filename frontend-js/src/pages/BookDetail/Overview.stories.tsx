import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { toBookDetail } from "../../api";
import { bookDetailHandlers } from "../../testing/handlers";
import { aWireBook } from "../../testing/wire";
import { Overview } from "./Overview";
import "./BookDetail.css";

function aBook(overrides: Parameters<typeof aWireBook>[0] = {}) {
  return toBookDetail(aWireBook({ series_id: 4, ...overrides }));
}

const meta = {
  title: "Pages/BookDetail/Overview",
  component: Overview,
  args: { book: aBook() },
  beforeEach({ msw }) {
    msw.use(...bookDetailHandlers(aWireBook()));
  },
} satisfies Meta<typeof Overview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LongDescription: Story = {
  args: {
    book: aBook({
      description: `<p>${"A station at the edge of the map hears something answer. ".repeat(6)}</p>`,
    }),
  },
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole("button", { name: "Show more" });
    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveTextContent("Show less");
  },
};

export const SparseDescriptionOffersFetchSummary: Story = {
  args: { book: aBook({ description: "<p>Too short.</p>" }) },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Fetch Summary" }),
    ).toBeEnabled();
  },
};

export const LongDescriptionHasNoFetchSummary: Story = {
  args: {
    book: aBook({
      description: `<p>${"A station at the edge of the map hears something answer. ".repeat(3)}</p>`,
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: "Fetch Summary" }),
    ).not.toBeInTheDocument();
  },
};

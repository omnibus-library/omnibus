import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { toBookDetail } from "../../api";
import { ToastProvider } from "../../components/Toast/Toast";
import { bookDetailHandlers } from "../../testing/handlers";
import { aWireBook } from "../../testing/wire";
import { Overview } from "./Overview";
import "./BookDetail.css";
import "./BookPage.css";

function aBook(overrides: Parameters<typeof aWireBook>[0] = {}) {
  return toBookDetail(aWireBook({ series_id: 4, ...overrides }));
}

const meta = {
  title: "Pages/BookDetail/Overview",
  component: Overview,
  args: { book: aBook(), onOpenDialog: fn() },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="bp-root">
          <Story />
        </div>
      </ToastProvider>
    ),
  ],
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

const LONG = `<p>${"A station at the edge of the map hears something answer, and the crew must decide whether to reply. ".repeat(8)}</p>`;

export const DescriptionClampsToThreeLinesWithShowMore: Story = {
  args: { book: aBook({ description: LONG }) },
  play: async ({ canvas, userEvent }) => {
    const description = canvas.getByTestId("book-description");
    const toggle = canvas.getByRole("button", { name: "Show more" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(getComputedStyle(description).webkitLineClamp).toBe("3");
    // Clamped: three 28.8 px lines of the 18 px / 1.6 text, with the rest cut off.
    await expect(description.clientHeight).toBeLessThanOrEqual(90);
    await expect(description.scrollHeight).toBeGreaterThan(
      description.clientHeight,
    );

    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveTextContent("Show less");
    await expect(description.clientHeight).toBeGreaterThan(90);
    await expect(description.scrollHeight).toBeLessThanOrEqual(
      description.clientHeight + 1,
    );
  },
};

export const ShortParagraphsPastThreeLinesOfferShowMore: Story = {
  args: {
    book: aBook({
      description: "<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>",
    }),
  },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("button", { name: "Show more" });

    await userEvent.click(toggle);

    await expect(toggle).toHaveTextContent("Show less");
    await expect(canvas.getByText("Four.")).toBeVisible();
  },
};

export const ShortDescriptionHasNoShowMore: Story = {
  args: { book: aBook({ description: "<p>A short one.</p>" }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("book-description")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  },
};

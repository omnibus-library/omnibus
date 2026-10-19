import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { parseBookUuid, toJournalEntry, toUser } from "../../api";
import { aWireJournalEntry, WIRE_ADA } from "../../testing/wire";
import { JournalEntryCard } from "./JournalEntryCard";

const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");

if (!UUID) throw new Error("fixture uuid");

const LONG = "x".repeat(901);

const entry = (overrides: Parameters<typeof aWireJournalEntry>[0] = {}) =>
  toJournalEntry(aWireJournalEntry(overrides));

const meta = {
  title: "Pages/BookDetail/JournalEntryCard",
  component: JournalEntryCard,
  args: { uuid: UUID, entry: entry(), viewer: toUser(WIRE_ADA) },
} satisfies Meta<typeof JournalEntryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShortEntry: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("The footnotes have footnotes."),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("journal-show-more"),
    ).not.toBeInTheDocument();
  },
};

export const LongEntryOpensClipped: Story = {
  args: { entry: entry({ body_md: LONG, body_html: `<p>${LONG}</p>` }) },
  play: async ({ canvas, userEvent }) => {
    const body = canvas.getByText(LONG);
    await expect(body.parentElement).toHaveClass(
      "bd-journal-entry-body-collapsed",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Show more ↓" }));

    await expect(body.parentElement).not.toHaveClass(
      "bd-journal-entry-body-collapsed",
    );
    await expect(
      canvas.queryByTestId("journal-show-more"),
    ).not.toBeInTheDocument();
  },
};

export const LongEntryInFullWhenNotCollapsible: Story = {
  args: {
    entry: entry({ body_md: LONG, body_html: `<p>${LONG}</p>` }),
    collapsible: false,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByTestId("journal-show-more"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByText(LONG).parentElement).not.toHaveClass(
      "bd-journal-entry-body-collapsed",
    );
  },
};

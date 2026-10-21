import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { parseBookUuid, toJournalEntry, toUser } from "../../api";
import { aWireJournalEntry, WIRE_ADA } from "../../testing/wire";
import { JournalEntryCard } from "./JournalEntryCard";

const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");

if (!UUID) throw new Error("fixture uuid");

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
  },
};

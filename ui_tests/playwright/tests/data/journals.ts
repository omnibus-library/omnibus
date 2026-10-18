import { uniqueSuffix } from "./unique";

/** Whether an entry shows in the shared feed or only to its author. */
export type JournalStatus = "draft" | "published";

/** The id the server gave a journal entry; the rest of the entry goes unread. */
export type JournalEntryRef = { id: number };

/** Text no other entry shares, so a feed row or open card is told apart by it. */
export function journalMarker(label: string): string {
  return `e2e-${label}-${uniqueSuffix()}`;
}

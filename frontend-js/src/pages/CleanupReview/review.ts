import type { CleanupAction, CleanupKind, SuggestionCard } from "../../api";

const KIND_TITLES = {
  author: "Review authors",
  series: "Review series",
  tag: "Review tags",
  book_title: "Review book titles",
} satisfies Record<CleanupKind, string>;

/** The heading of a kind's queue; a slug that names no kind gets the general one. */
export const kindTitle = (kind: CleanupKind | null) =>
  kind === null ? "Review library cleanup" : KIND_TITLES[kind];

/** Whether the proposed value is the reviewer's to rewrite: only a book-title rename takes a title of its own. */
export const isEditable = (card: SuggestionCard) =>
  card.kind === "book_title" && card.action === "rename";

/** The value a card opens with: the detector's proposal for a rename, else the surviving name. */
export const initialValue = (card: SuggestionCard) =>
  card.action === "rename" ? (card.secondary_name ?? "") : card.primary_name;

const ACTION_SENTENCES: Partial<
  Record<CleanupKind, Partial<Record<CleanupAction, string>>>
> = {
  author: {
    merge: "Merge these authors into one.",
    delete: "Delete this author record.",
  },
  series: { merge: "Merge these series into one." },
  tag: {
    merge: "Merge these tags into one.",
    split: "Split this tag into its parts.",
  },
  book_title: { rename: "Adopt the normalized title." },
};

/** What accepting a card does, in one line. */
export const actionSentence = (kind: CleanupKind, action: CleanupAction) =>
  ACTION_SENTENCES[kind]?.[action] ?? "Apply this cleanup.";

/** The label over the value being replaced. */
export const scannedLabel = (action: CleanupAction) =>
  ({
    rename: "Scanned title",
    split: "Scanned tag",
    delete: "Record",
    merge: "Merging away",
  })[action];

/** The label over the value that replaces it; a delete has no such side. */
export const proposedLabel = (action: Exclude<CleanupAction, "delete">) =>
  ({
    rename: "Proposed title",
    split: "Splits into",
    merge: "Surviving name",
  })[action];

/** Which dot a slot is: already passed, under review, or still ahead. */
export const dotState = (slot: number, index: number) =>
  slot < index ? "done" : slot === index ? "on" : "";

/** What the note beside the buttons says accepting will do. */
export function decideNote(edited: boolean, editable: boolean): string {
  if (edited) return "your wording replaces the proposal";
  return editable
    ? "accepting applies at once · you can undo it"
    : "accepting applies at once";
}

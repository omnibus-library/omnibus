/** The kinds of record the Library cleanup section reviews. */
export type CleanupKind = "author" | "series" | "tag" | "book_title";

export const CLEANUP_KINDS: CleanupKind[] = [
  "author",
  "series",
  "tag",
  "book_title",
];

/** A pending suggestion as `POST /api/rpc/cleanup/queue` lists it. */
export type SuggestionCard = {
  id: number;
  kind: string;
  action: string;
  decision: string;
  primary_name: string;
  secondary_name: string | null;
  source_names: string[];
  proposed_parts: string[];
  book_count: number;
  photo_url: string | null;
  created_at: number;
};

export type CleanupDecision = "accepted" | "rejected";

export const AUTHOR_MERGE_CARD: SuggestionCard = {
  id: 4242,
  kind: "author",
  action: "merge",
  decision: "pending",
  primary_name: "Mary Shelley",
  secondary_name: "Shelley, Mary W.",
  source_names: ["Shelley, Mary W."],
  proposed_parts: [],
  book_count: 3,
  photo_url: null,
  created_at: 1_700_000_000,
};

export const TITLE_RENAME_CARD: SuggestionCard = {
  id: 4343,
  kind: "book_title",
  action: "rename",
  decision: "pending",
  primary_name: "Shelley, Mary - Frankenstein",
  secondary_name: "Frankenstein",
  source_names: [],
  proposed_parts: [],
  book_count: 1,
  photo_url: null,
  created_at: 1_700_000_000,
};

import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  getCleanupCounts,
  getCleanupQueue,
  getPostCleanupDetectUrl,
  postCleanupDecision,
} from "./generated/omnibus";
import { CleanupKind } from "./generated/schemas";

export type {
  CleanupAction,
  CleanupKindCounts,
  SuggestionCard,
} from "./generated/schemas";
export type { CleanupKind };

const LABELS = {
  author: "Authors",
  series: "Series",
  tag: "Tags",
  book_title: "Book titles",
} satisfies Record<CleanupKind, string>;

/** Every kind, in the order the server lists them. */
export const CLEANUP_KINDS = CleanupKind.options;

/** The kind a route's slug names, or null when it names none. */
export const parseCleanupKind = (slug: string): CleanupKind | null =>
  CleanupKind.safeParse(slug).data ?? null;

/** A cleanup kind's name in the plural, as the screens list it. */
export const cleanupKindLabel = (kind: CleanupKind) => LABELS[kind];

/** How many suggestions each kind has pending, accepted and rejected. */
export const cleanupCountsQuery = queryOptions({
  queryKey: ["admin", "cleanup", "counts"],
  queryFn: async () => ok(await getCleanupCounts()),
});

/** Queues a pass of every detector; the counts change as it finishes. */
export async function detectCleanup() {
  // The route answers with no body, so the generated fetcher would JSON-parse a refusal's plain text.
  await send(getPostCleanupDetectUrl(), "POST");
}

/**
 * A kind's pending suggestions, oldest first. A pass works through the list as fetched:
 * nothing refetches under the cursor, and each visit reads afresh.
 */
export const cleanupQueueQuery = (kind: CleanupKind) =>
  queryOptions({
    queryKey: ["admin", "cleanup", "queue", kind],
    queryFn: async () => ok(await getCleanupQueue(kind)),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });

/** Applies or dismisses one suggestion; answers the change an accept made, or null for a reject. */
export async function decideCleanup(
  id: number,
  decision: "accepted" | "rejected",
): Promise<number | null> {
  return ok(await postCleanupDecision(id, { decision })).log_id ?? null;
}

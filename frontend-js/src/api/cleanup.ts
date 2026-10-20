import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import { getCleanupCounts, getPostCleanupDetectUrl } from "./generated/omnibus";
import type { CleanupKind } from "./generated/schemas";

export type { CleanupKind, CleanupKindCounts } from "./generated/schemas";

const LABELS = {
  author: "Authors",
  series: "Series",
  tag: "Tags",
  book_title: "Book titles",
} satisfies Record<CleanupKind, string>;

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

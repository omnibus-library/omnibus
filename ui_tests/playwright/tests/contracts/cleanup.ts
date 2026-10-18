import type {
  CleanupDecision,
  CleanupKind,
  SuggestionCard,
} from "../data/cleanup";
import type { ExpectMutationOptions } from "../utils/api";

/** The endpoints the Library cleanup section and its review page call. */
export const cleanupUrls = {
  counts: /\/api\/rpc\/cleanup\/counts(?:\?|$)/,
  detect: /\/api\/rpc\/cleanup\/detect(?:\?|$)/,
  queue: /\/api\/rpc\/cleanup\/queue(?:\?|$)/,
  decide: /\/api\/rpc\/cleanup\/decide(?:\?|$)/,
};

/** The reads and writes of reviewing a library's cleanup suggestions. */
export const cleanup = {
  /** A read the section makes on load, not on a click. */
  counts: (): ExpectMutationOptions => ({
    method: "POST",
    url: cleanupUrls.counts,
    expectedStatus: 200,
  }),

  detect: (): ExpectMutationOptions => ({
    method: "POST",
    url: cleanupUrls.detect,
    expectedBody: { kind: null },
    expectedStatus: 200,
  }),

  queue: (kind: CleanupKind): ExpectMutationOptions => ({
    method: "POST",
    url: cleanupUrls.queue,
    expectedBody: { kind, limit: 50 },
    expectedStatus: 200,
  }),

  /** `value` is the reviewer's own wording, or null to accept the proposal. */
  decide: (
    card: Pick<SuggestionCard, "id">,
    decision: CleanupDecision,
    value: string | null = null,
  ): ExpectMutationOptions => ({
    method: "POST",
    url: cleanupUrls.decide,
    expectedBody: { id: card.id, decision, value },
    expectedStatus: 200,
  }),
};

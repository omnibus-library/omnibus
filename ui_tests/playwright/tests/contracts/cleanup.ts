import type {
  CleanupDecision,
  CleanupKind,
  SuggestionCard,
} from "../data/cleanup";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoints the Library cleanup section and its review page call. */
export const cleanupUrls = {
  counts: /\/api\/rpc\/cleanup\/counts(?:\?|$)/,
  detect: /\/api\/rpc\/cleanup\/detect(?:\?|$)/,
  queue: /\/api\/rpc\/cleanup\/queue(?:\?|$)/,
  decide: /\/api\/rpc\/cleanup\/decide(?:\?|$)/,
  undo: /\/api\/rpc\/cleanup\/undo(?:\?|$)/,
};

/** The reads and writes of reviewing a library's cleanup suggestions. */
export const cleanup = {
  /** A read the section makes on load, not on a click. */
  counts: (): ExpectMutationOptions => post(cleanupUrls.counts),

  detect: (): ExpectMutationOptions => post(cleanupUrls.detect, { kind: null }),

  queue: (kind: CleanupKind): ExpectMutationOptions =>
    post(cleanupUrls.queue, { kind, limit: 50 }),

  /**
   * `value` is the reviewer's own wording, or null to accept the proposal.
   * With no card, any decision matches.
   */
  decide: (
    card?: Pick<SuggestionCard, "id">,
    decision?: CleanupDecision,
    value: string | null = null,
  ): ExpectMutationOptions =>
    post(
      cleanupUrls.decide,
      card && decision ? { id: card.id, decision, value } : undefined,
    ),

  /** `logId` names the `cleanup_log` row of the decision being taken back. */
  undo: (logId: number): ExpectMutationOptions =>
    post(cleanupUrls.undo, { log_id: logId }),
};

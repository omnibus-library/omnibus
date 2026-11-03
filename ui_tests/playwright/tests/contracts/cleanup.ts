import type {
  CleanupDecision,
  CleanupKind,
  SuggestionCard,
} from "../data/cleanup";
import { type ExpectMutationOptions, get, post } from "../utils/api";

/** The endpoints the Library cleanup section and its review page call. */
export const cleanupUrls = {
  counts: /\/api\/admin\/cleanup\/counts(?:\?|$)/,
  detect: /\/api\/admin\/cleanup\/detect(?:\?|$)/,
  queue: /\/api\/admin\/cleanup\/[a-z_]+\/queue(?:\?|$)/,
  decide: /\/api\/admin\/cleanup\/suggestions\/\d+\/decision(?:\?|$)/,
  undo: /\/api\/admin\/cleanup\/undo\/\d+(?:\?|$)/,
};

/** The reads and writes of reviewing a library's cleanup suggestions. */
export const cleanup = {
  /** A read the section makes on load, not on a click. */
  counts: (): ExpectMutationOptions => get(cleanupUrls.counts),

  detect: (): ExpectMutationOptions => post(cleanupUrls.detect, undefined, 202),

  queue: (kind: CleanupKind): ExpectMutationOptions =>
    get(new RegExp(`/api/admin/cleanup/${kind}/queue(?:\\?|$)`)),

  /**
   * `value` is the reviewer's own wording, or null to accept the proposal.
   * With no card, any decision matches.
   */
  decide: (
    card?: Pick<SuggestionCard, "id">,
    decision?: CleanupDecision,
    value: string | null = null,
  ): ExpectMutationOptions =>
    card && decision
      ? post(
          new RegExp(`/api/admin/cleanup/suggestions/${card.id}/decision$`),
          value === null ? { decision } : { decision, value },
        )
      : post(cleanupUrls.decide),

  /** `logId` names the `cleanup_log` row of the decision being taken back. */
  undo: (logId: number): ExpectMutationOptions =>
    post(new RegExp(`/api/admin/cleanup/undo/${logId}$`), undefined, 204),
};

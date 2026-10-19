import type { ProviderSearchSource } from "../../api/generated/schemas";

/** A cooldown as a reader would say it: rounded up, and never "0s". */
export const humanWait = (secs: number) =>
  secs <= 90 ? `${Math.max(secs, 1)}s` : `${Math.ceil(secs / 60)}m`;

/** What one source contributed, in as few words as the distinction allows, and whether it reads as a problem. */
export function sourceStatusText({ status }: ProviderSearchSource): {
  text: string;
  problem: boolean;
  detail: string;
} {
  switch (status.kind) {
    case "answered":
      return {
        text: status.count === 0 ? "nothing" : String(status.count),
        problem: false,
        detail: "",
      };
    case "not_configured":
      return { text: "not set up", problem: false, detail: "" };
    case "failed":
      return { text: "unavailable", problem: true, detail: status.message };
    case "throttled":
      // Worded as what we are doing: a keyless Google Books refuses until its daily quota resets, however long anyone waits.
      return {
        text: `rate limited, skipping for ${humanWait(status.retry_after_secs)}`,
        problem: true,
        detail:
          "This source rate-limited us recently; it is being left alone until the cooldown ends.",
      };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

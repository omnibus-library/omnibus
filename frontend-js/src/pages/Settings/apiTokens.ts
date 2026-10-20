import { MONTHS, unitsAgo } from "../../format";

const DAY = 86_400;
const IDLE_AFTER = 30 * DAY;

export type PillTone = "unused" | "active" | "idle";

/** How a token's last use reads: a tone and a label. Idle past 30 days. */
export function statusPill(
  now: number,
  lastUsed: number | null | undefined,
): { tone: PillTone; label: string } {
  if (lastUsed == null) return { tone: "unused", label: "Never used" };
  const age = Math.max(0, now - lastUsed);
  return age <= IDLE_AFTER
    ? { tone: "active", label: "Active" }
    : { tone: "idle", label: `Idle ${Math.floor(age / DAY)}d` };
}

// shortcut: UTC days, matching Dioxus; switch to the reader's offset (rule 10) when both clients move.
/** A day count: "today", "yesterday", "N days ago" inside a month, then "14 Jul", with the year once it differs from now's. */
export function relDate(now: number, ts: number): string {
  const days = Math.floor(now / DAY) - Math.floor(ts / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 30) return unitsAgo(days, "day");
  const then = new Date(ts * 1000);
  const day = `${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]}`;
  return then.getUTCFullYear() === new Date(now * 1000).getUTCFullYear()
    ? day
    : `${day} ${then.getUTCFullYear()}`;
}

/** The `claude mcp add` one-liner for this instance, with a bearer value (the secret, or a placeholder). */
export const mcpCommand = (origin: string, bearer: string) =>
  `claude mcp add --transport http omnibus ${origin}/mcp --header "Authorization: Bearer ${bearer}"`;

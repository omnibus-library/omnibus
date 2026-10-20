import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  clearSmtpConfig,
  getSmtpConfig,
  getTestSmtpConfigUrl,
  setSmtpConfig,
} from "./generated/omnibus";
import type { SmtpConfigStatus, SmtpConfigUpdate } from "./generated/schemas";

export type {
  SmtpConfigStatus,
  SmtpConfigUpdate,
} from "./generated/schemas";

// The Integrations section's reads and writes. Every query key starts with "admin".

/** The relay Send to Kindle emails through; its password comes back masked. */
export const smtpConfigQuery = queryOptions({
  queryKey: ["admin", "smtp"],
  queryFn: async () => ok(await getSmtpConfig()),
});

/** Replaces the relay; answers what the server now holds. */
export async function saveSmtpConfig(
  update: SmtpConfigUpdate,
): Promise<SmtpConfigStatus> {
  return ok(await setSmtpConfig(update));
}

/** Removes the saved relay, host, sign-in and password; answers what is left. */
export async function resetSmtpConfig(): Promise<SmtpConfigStatus> {
  return ok(await clearSmtpConfig());
}

/** Sends a test email to the signed-in account's Kindle address through the relay. */
export async function sendSmtpTest() {
  // The route answers with no body, so the generated fetcher would JSON-parse a refusal's plain text.
  await send(getTestSmtpConfigUrl(), "POST");
}

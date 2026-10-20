import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  adminListUsers,
  getAdminUnlockUserUrl,
  getPostRegistrationUrl,
  getRegistration,
} from "./generated/omnibus";

export type { AdminUserRow } from "./generated/schemas";

// The People section's reads and writes. Every query key starts with "admin".

/**
 * Whether self-registration is open, read for the switch. It keeps its own key
 * and fails loudly, unlike the sign-in page's `registrationQuery`, which reads a
 * failure as open.
 */
export const registrationStatusQuery = queryOptions({
  queryKey: ["admin", "registration"],
  queryFn: async () => ok(await getRegistration()).enabled,
});

/** Opens or closes self-registration. */
export async function setRegistrationOpen(enabled: boolean) {
  // The route answers with no body, so the generated fetcher would JSON-parse a refusal's plain text.
  await send(getPostRegistrationUrl(), "POST", { enabled });
}

/** Every account on the server. */
export const adminUsersQuery = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: async () => ok(await adminListUsers()),
});

/** Clears an account's failed-login lockout. */
export async function unlockUser(id: number) {
  await send(getAdminUnlockUserUrl(id), "POST");
}

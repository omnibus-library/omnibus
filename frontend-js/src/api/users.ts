import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  adminListUserDevices,
  adminListUserSessions,
  adminListUsers,
  getAdminCreateUserUrl,
  getAdminDeleteDeviceUrl,
  getAdminDeleteSessionUrl,
  getAdminDeleteUserUrl,
  getAdminSetUserPasswordUrl,
  getAdminSetUserPermissionsUrl,
  getAdminUnlockUserUrl,
  getPostRegistrationUrl,
  getRegistration,
} from "./generated/omnibus";
import type { CreateUserRequest, UserPermissions } from "./generated/schemas";

export type {
  AdminUserRow,
  CreateUserRequest,
  DeviceView,
  SessionView,
  UserPermissions,
} from "./generated/schemas";

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

/** Makes an account, whether or not registration is open. */
export async function createUser(request: CreateUserRequest) {
  await send(getAdminCreateUserUrl(), "POST", request);
}

/** Replaces an account's four permission flags. */
export async function setUserPermissions(
  id: number,
  permissions: UserPermissions,
) {
  await send(getAdminSetUserPermissionsUrl(id), "PATCH", permissions);
}

/** Sets an account's password without asking for the old one. */
export async function setUserPassword(id: number, password: string) {
  await send(getAdminSetUserPasswordUrl(id), "POST", { password });
}

/** Deletes an account and everything it owns. */
export async function deleteUser(id: number) {
  await send(getAdminDeleteUserUrl(id), "DELETE");
}

/** An account's live sessions. */
export const userSessionsQuery = (id: number) =>
  queryOptions({
    queryKey: ["admin", "user-sessions", id],
    queryFn: async () => ok(await adminListUserSessions(id)),
  });

/** An account's registered devices. */
export const userDevicesQuery = (id: number) =>
  queryOptions({
    queryKey: ["admin", "user-devices", id],
    queryFn: async () => ok(await adminListUserDevices(id)),
  });

/** Ends one of any account's sessions. */
export async function revokeUserSession(id: number) {
  await send(getAdminDeleteSessionUrl(id), "DELETE");
}

/** Unregisters one of any account's devices, and ends the sessions tied to it. */
export async function revokeUserDevice(id: number) {
  await send(getAdminDeleteDeviceUrl(id), "DELETE");
}

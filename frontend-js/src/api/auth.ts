import type { Credentials, UserId } from "./core";
import { failure, ok } from "./core";
import {
  getLogoutUrl,
  getMe,
  getRegistration,
  login as postLogin,
  register as postRegister,
  postStackSeries,
} from "./generated/omnibus";
import type { UserSummary } from "./generated/schemas";

/** The screen's shape of the user `GET /api/auth/me` and sign-in answer with. */
export function toUser(user: UserSummary) {
  return {
    id: user.id as UserId,
    username: user.username,
    name: user.display_name ?? user.username,
    isAdmin: user.is_admin,
    canUpload: user.can_upload,
    canEdit: user.can_edit,
    hasAvatar: user.has_avatar ?? false,
    hiddenFormats: user.hidden_formats ?? [],
    stackSeries: user.stack_series ?? false,
  };
}

export type User = ReturnType<typeof toUser>;

/** The signed-in user, or `null` when the session cookie is missing or dead. */
export async function fetchMe(): Promise<User | null> {
  const res = await getMe();
  if (res.status === 401) return null;
  if (res.status !== 200) throw failure(res);
  return toUser(res.data);
}

/** Opens a cookie session; the server sets the cookie on the response. */
export async function login(credentials: Credentials): Promise<User> {
  return toUser(ok(await postLogin(credentials)).user);
}

/** Opens a cookie session for a new account; the server sets the cookie. */
export async function register(credentials: Credentials): Promise<User> {
  return toUser(ok(await postRegister(credentials)).user);
}

/** Whether self-registration is open; an admin can close it. */
export async function fetchRegistrationOpen(): Promise<boolean> {
  return ok(await getRegistration()).enabled;
}

export async function logout(): Promise<void> {
  // The generated fetcher JSON-parses any body, and an error's is plain text.
  const res = await fetch(getLogoutUrl(), { method: "POST" });
  if (res.status !== 204) {
    throw failure({ status: res.status, data: await res.text() });
  }
}

/** Saves the reader's Stack series preference. */
export async function setStackSeries(enabled: boolean): Promise<void> {
  ok(await postStackSeries({ enabled }));
}

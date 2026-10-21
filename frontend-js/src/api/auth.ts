import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { Credentials, UserId } from "./core";
import { failure, fetchJson, ok, send } from "./core";
import {
  getCreateApiTokenUrl,
  getDeleteSessionUrl,
  getListApiTokensUrl,
  getListSessionsUrl,
  getLogoutUrl,
  getMe,
  getRegistration,
  getRenameApiTokenUrl,
  getRevokeApiTokenUrl,
  login as postLogin,
  register as postRegister,
} from "./generated/omnibus";
import {
  ApiTokenView,
  CreateApiTokenResponse,
  SessionView,
  type UserSummary,
} from "./generated/schemas";

export type { ApiTokenView, SessionView } from "./generated/schemas";

/** The screen's shape of the user `GET /api/auth/me` and sign-in answer with. */
export function toUser(user: UserSummary) {
  return {
    id: user.id as UserId,
    username: user.username,
    name: user.display_name ?? user.username,
    displayName: user.display_name ?? null,
    kindleEmail: user.kindle_email ?? null,
    isAdmin: user.is_admin,
    canUpload: user.can_upload,
    canEdit: user.can_edit,
    canDownload: user.can_download,
    hasAvatar: user.has_avatar ?? false,
    hiddenFormats: user.hidden_formats ?? [],
    stackSeries: user.stack_series ?? false,
    bookDetailScrollStops: user.book_detail_scroll_stops ?? false,
    // Matches the wire default: stats are shared until a reader opts out.
    shareStats: user.share_stats ?? true,
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

/** The reader's live sessions, the one making the request flagged `is_current`. */
export const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: () => fetchJson(getListSessionsUrl(), z.array(SessionView)),
});

/** Signs one of the reader's other sessions out. */
export async function revokeSession(id: number): Promise<void> {
  await send(getDeleteSessionUrl(id), "DELETE");
}

/** The reader's API tokens, newest first. They never carry the secret. */
export const apiTokensQuery = queryOptions({
  queryKey: ["api-tokens"],
  queryFn: () => fetchJson(getListApiTokensUrl(), z.array(ApiTokenView)),
});

/** Mints a token named `name`; the answer holds its only readable copy of the secret. */
export async function createApiToken(name: string) {
  const res = await send(getCreateApiTokenUrl(), "POST", { name });
  return CreateApiTokenResponse.parse(await res.json());
}

export async function renameApiToken(id: number, name: string): Promise<void> {
  await send(getRenameApiTokenUrl(id), "PATCH", { name });
}

/** Cuts the token's client off at its next request. */
export async function revokeApiToken(id: number): Promise<void> {
  await send(getRevokeApiTokenUrl(id), "DELETE");
}

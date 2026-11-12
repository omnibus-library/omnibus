import { uniqueDigits, uniqueSuffix } from "./unique";

/** How the server signs in to an ntfy server. */
export type NtfyAuth = "none" | "token" | "basic";

/** `GET /api/settings/public-url`: the URL in effect and where it came from. */
export interface PublicUrlStatus {
  url: string | null;
  source: "settings" | "env" | "none";
}

/** A connection's ntfy settings as a client sends them; a secret left out keeps the saved one. */
export interface NtfySettingsInput {
  kind: "ntfy";
  server_url: string;
  topic: string;
  auth: NtfyAuth;
  username?: string;
  token?: string;
  password?: string;
  priority: number;
  tags: string[];
  include_details: boolean;
}

/** `POST` and `PUT /api/admin/notifications/connections`. */
export interface NotificationConnectionInput {
  name: string;
  enabled: boolean;
  events: string[];
  settings: NtfySettingsInput;
}

/** A saved connection as the server lists it: secrets only say whether one is set. */
export interface NotificationConnection {
  id: number;
  name: string;
  enabled: boolean;
  events: string[];
  settings: Omit<NtfySettingsInput, "token" | "password" | "username"> & {
    username: string | null;
    token_set: boolean;
    password_set: boolean;
  };
  last_delivery: { at: number; ok: boolean; error: string | null } | null;
}

/** `GET /api/admin/notifications/connections`. */
export interface NotificationConnections {
  connections: NotificationConnection[];
  available_events: string[];
}

/**
 * Nothing listens on the discard port, so a test notification there fails fast as a
 * network error: the 502 path, with no ntfy server in the suite.
 */
export const CLOSED_NTFY_SERVER = "http://127.0.0.1:9";

/** A public URL no other call returns. */
export function buildPublicUrl(): string {
  return `https://books-${uniqueDigits()}.example.test`;
}

/** An ntfy connection with a token, a name and a topic of its own, posting to a closed port. */
export function buildNtfyConnection(
  overrides: Partial<NotificationConnectionInput> = {},
): NotificationConnectionInput {
  const suffix = uniqueSuffix();
  return {
    name: `E2E ntfy ${suffix}`,
    enabled: true,
    events: [],
    settings: {
      kind: "ntfy",
      server_url: CLOSED_NTFY_SERVER,
      topic: `omnibus-e2e-${uniqueDigits()}`,
      auth: "token",
      token: `tk_e2e_${suffix}`,
      priority: 3,
      tags: [],
      include_details: true,
    },
    ...overrides,
  };
}

/** Where a connection posts, as its row names it: the server without its scheme, then the topic. */
export function topicAddress(
  settings: Pick<NtfySettingsInput, "server_url" | "topic">,
): string {
  const server = settings.server_url
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `${server}/${settings.topic}`;
}

/** What a save of `connection` sends with no secret typed: leaving the token out keeps the saved one. */
export function savedWithoutSecrets(
  connection: NotificationConnection,
  change: Partial<NotificationConnectionInput> = {},
): NotificationConnectionInput {
  const { settings } = connection;
  return {
    name: connection.name,
    enabled: connection.enabled,
    events: connection.events,
    settings: {
      kind: "ntfy",
      server_url: settings.server_url,
      topic: settings.topic,
      auth: settings.auth,
      priority: settings.priority,
      tags: settings.tags,
      include_details: settings.include_details,
    },
    ...change,
  };
}

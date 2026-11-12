import { z } from "zod";
import {
  ApiError,
  type ConnectionSettingsInput,
  isHttpUrl,
  type NotificationConnection,
  type NotificationConnectionInput,
  NotificationEvent,
  type NotificationLastDelivery,
  type NotificationTest,
  NtfyAuth,
} from "../../api";
import { ago } from "../../format";

/** The ntfy form's fields as the inputs hold them; the priority stays text until a save reads it. */
const DraftFields = z.object({
  name: z.string(),
  server_url: z.string(),
  topic: z.string(),
  auth: NtfyAuth,
  username: z.string(),
  token: z.string(),
  password: z.string(),
  priority: z.string(),
  tags: z.string(),
  include_details: z.boolean(),
  events: z.array(NotificationEvent),
  enabled: z.boolean(),
});

export type ConnectionDraft = z.infer<typeof DraftFields>;

/** A form field a refusal can point at. */
export type DraftField = keyof ConnectionDraft;

/** The fields a test sends; a test needs no name, events or on switch. */
export const SETTINGS_FIELDS = [
  "server_url",
  "topic",
  "auth",
  "username",
  "token",
  "password",
  "priority",
  "tags",
] as const satisfies readonly DraftField[];

/**
 * Which secrets the connection being edited holds for the mode it was saved in, and the
 * address and username they belong to; none for a new one.
 */
export type SavedSecrets = {
  token: boolean;
  password: boolean;
  serverUrl: string;
  username: string;
};

export const NO_SAVED_SECRETS: SavedSecrets = {
  token: false,
  password: false,
  serverUrl: "",
  username: "",
};

/** One of the two secrets a connection can hold. */
export type SecretField = "token" | "password";

/**
 * Whether a blank secret field keeps the saved secret for the form as it stands:
 * `kept`, or why it must be typed again; `none` when there is no saved one for this mode.
 */
export type SecretState =
  | "none"
  | "kept"
  | "server_url_changed"
  | "username_changed";

export const NAME_MAX_CHARS = 100;

// ntfy's own rule for a topic.
const TOPIC = /^[-_A-Za-z0-9]{1,64}$/;

export const AUTH_LABELS: Record<NtfyAuth, string> = {
  none: "None",
  token: "Access token",
  basic: "Username and password",
};

/** ntfy's five priorities, by the names its apps show. */
export const PRIORITIES = [
  { value: "1", label: "Min (1)" },
  { value: "2", label: "Low (2)" },
  { value: "3", label: "Default (3)" },
  { value: "4", label: "High (4)" },
  { value: "5", label: "Urgent (5)" },
] as const;

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  request_needs_chooser: "A request needs a version picked",
};

/** A new connection's form: no sign-in, ntfy's default priority, on, and sent every event the server offers. */
export const blankDraft = (
  available: NotificationEvent[],
): ConnectionDraft => ({
  name: "",
  server_url: "",
  topic: "",
  auth: "none",
  username: "",
  token: "",
  password: "",
  priority: "3",
  tags: "",
  include_details: true,
  events: [...available],
  enabled: true,
});

/** The tags typed as a comma-separated list, trimmed, blanks dropped. */
export const parseTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

export const tagsText = (tags: readonly string[]) => tags.join(", ");

/** The form as a saved connection fills it; a secret is never read back, so both secret fields start blank. */
export function draftOf(connection: NotificationConnection): ConnectionDraft {
  const { settings } = connection;
  return {
    name: connection.name,
    server_url: settings.server_url,
    topic: settings.topic,
    auth: settings.auth,
    username: settings.username ?? "",
    token: "",
    password: "",
    priority: String(Math.min(5, Math.max(1, settings.priority))),
    tags: tagsText(settings.tags),
    include_details: settings.include_details,
    events: [...connection.events],
    enabled: connection.enabled,
  };
}

/** The secrets `connection` holds; switching the form to another mode starts that mode with none. */
export function savedSecretsOf(
  connection: NotificationConnection,
): SavedSecrets {
  const { auth, token_set, password_set, server_url, username } =
    connection.settings;
  return {
    token: auth === "token" && token_set,
    password: auth === "basic" && password_set,
    serverUrl: server_url,
    username: username ?? "",
  };
}

/**
 * Whether `secret` may be left blank: the server lends a saved secret only to the address
 * it was saved for, and a password only to its own username as well.
 */
export function secretState(
  draft: Pick<ConnectionDraft, "auth" | "server_url" | "username">,
  saved: SavedSecrets,
  secret: SecretField,
): SecretState {
  const held =
    secret === "token"
      ? saved.token && draft.auth === "token"
      : saved.password && draft.auth === "basic";
  if (!held) return "none";
  if (draft.server_url.trim() !== saved.serverUrl.trim()) {
    return "server_url_changed";
  }
  if (
    secret === "password" &&
    draft.username.trim() !== saved.username.trim()
  ) {
    return "username_changed";
  }
  return "kept";
}

const SECRET_NOUNS: Record<SecretField, string> = {
  token: "token",
  password: "password",
};

/** Why a saved secret has to be typed again, as the field's hint says it; null while it is kept or there is none. */
export function secretRetypeHint(state: SecretState, secret: SecretField) {
  const noun = SECRET_NOUNS[secret];
  switch (state) {
    case "server_url_changed":
      return `The server URL changed, so enter the ${noun} again.`;
    case "username_changed":
      return `The username changed, so enter the ${noun} again.`;
    default:
      return null;
  }
}

/**
 * The settings a save or a test sends. A blank secret is left out, so a saved one is kept;
 * `draftProblems` refuses a blank one there is no saved one to keep, so "" is never sent.
 */
export function settingsInputOf(
  draft: ConnectionDraft,
): ConnectionSettingsInput {
  const common = {
    kind: "ntfy" as const,
    server_url: draft.server_url.trim(),
    topic: draft.topic.trim(),
    priority: Number(draft.priority),
    tags: parseTags(draft.tags),
    include_details: draft.include_details,
  };
  switch (draft.auth) {
    case "none":
      return { ...common, auth: "none" };
    case "token": {
      const token = draft.token.trim();
      return { ...common, auth: "token", ...(token !== "" && { token }) };
    }
    case "basic":
      return {
        ...common,
        auth: "basic",
        username: draft.username.trim(),
        ...(draft.password !== "" && { password: draft.password }),
      };
    default: {
      const _exhaustive: never = draft.auth;
      return _exhaustive;
    }
  }
}

/** The whole connection a save sends. */
export const connectionInputOf = (
  draft: ConnectionDraft,
): NotificationConnectionInput => ({
  name: draft.name.trim(),
  enabled: draft.enabled,
  events: draft.events,
  settings: settingsInputOf(draft),
});

/** A switch flip: the connection as saved with `enabled` changed, and no secret, so the saved ones are kept. */
export const toggledInput = (
  connection: NotificationConnection,
  enabled: boolean,
): NotificationConnectionInput => ({
  ...connectionInputOf(draftOf(connection)),
  enabled,
});

/** A test of the form as it stands; with `id`, a secret it leaves blank comes from that saved connection. */
export const testOf = (
  draft: ConnectionDraft,
  id: number | null,
): NotificationTest => ({
  ...(id !== null && { id }),
  settings: settingsInputOf(draft),
});

/** A test of a saved connection as it is, with its saved secrets. */
export const savedTestOf = (connection: NotificationConnection) =>
  testOf(draftOf(connection), connection.id);

/** Why the form can't be sent, field by field; empty when it can. */
export function draftProblems(
  draft: ConnectionDraft,
  saved: SavedSecrets,
): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  const name = draft.name.trim();
  if (name === "") problems.name = "Give the connection a name.";
  else if ([...name].length > NAME_MAX_CHARS) {
    problems.name = `Keep the name to ${NAME_MAX_CHARS} characters.`;
  }
  const serverUrl = draft.server_url.trim();
  if (serverUrl === "")
    problems.server_url = "Enter the ntfy server’s address.";
  else if (!isHttpUrl(serverUrl)) {
    problems.server_url = "Enter an http:// or https:// address.";
  }
  const topic = draft.topic.trim();
  if (topic === "") problems.topic = "Enter a topic.";
  else if (!TOPIC.test(topic)) {
    problems.topic =
      "A topic is 1 to 64 letters, digits, hyphens or underscores.";
  }
  if (draft.auth === "token" && draft.token.trim() === "") {
    const state = secretState(draft, saved, "token");
    if (state !== "kept") problems.token = missingSecret(state, "token");
  }
  if (draft.auth === "basic") {
    if (draft.username.trim() === "") problems.username = "Enter the username.";
    const state = secretState(draft, saved, "password");
    if (draft.password === "" && state !== "kept") {
      problems.password = missingSecret(state, "password");
    }
  }
  return problems;
}

function missingSecret(state: SecretState, secret: SecretField): string {
  const again = secretRetypeHint(state, secret);
  if (again) return again;
  return secret === "token" ? "Enter the access token." : "Enter the password.";
}

/** The form's rules, read into the connection a save sends. */
export const connectionSchema = (saved: SavedSecrets) =>
  DraftFields.superRefine((draft, ctx) => {
    for (const [field, message] of Object.entries(
      draftProblems(draft, saved),
    )) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
  }).transform(connectionInputOf);

/** One event checkbox: what it says, and whether the server sends it now. */
export type EventChoice = {
  event: NotificationEvent;
  label: string;
  offered: boolean;
};

/** The events to offer: the server's, then any the connection holds that the server doesn't send now, so a save keeps them. */
export function eventChoices(
  available: readonly NotificationEvent[],
  saved: readonly NotificationEvent[],
): EventChoice[] {
  const kept = saved.filter((event) => !available.includes(event));
  return [
    ...available.map((event) => ({ event, offered: true })),
    ...kept.map((event) => ({ event, offered: false })),
  ].map((choice) => ({ ...choice, label: EVENT_LABELS[choice.event] }));
}

/** A refusal saying the connection is gone: someone deleted it since the list was read. */
export const isGone = (error: Error) =>
  error instanceof ApiError && error.status === 404;

/** Where a connection posts, as the ntfy apps name a topic: `ntfy.sh/omnibus`, whether or not the address ends in a slash. */
export const postsTo = (settings: NotificationConnection["settings"]) =>
  `${settings.server_url.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${settings.topic}`;

/** What a row's status line is about: a status is shown only while the connection still reads this way. */
export const connectionKey = (connection: NotificationConnection) =>
  JSON.stringify([
    connection.name,
    connection.enabled,
    connection.events,
    connection.settings,
  ]);

/** How the last finished notification went, as a row shows it. */
export type DeliveryLine =
  | { state: "none"; text: string }
  | { state: "ok"; text: string; at: number }
  | { state: "failed"; text: string; at: number; error: string };

export function deliveryLine(
  last: NotificationLastDelivery | null | undefined,
  now: number,
): DeliveryLine {
  if (!last) return { state: "none", text: "No deliveries yet" };
  const when = ago(now, last.at);
  return last.ok
    ? { state: "ok", text: `Delivered ${when}`, at: last.at }
    : {
        state: "failed",
        text: `Failed ${when}`,
        at: last.at,
        error: last.error || "No reason was recorded.",
      };
}

/** How much of a long error a row shows before "Show all". */
export const ERROR_PREVIEW_CHARS = 140;

/** `error` cut to `max` characters at a word break where one is near, or whole when it fits. */
export function clipError(
  error: string,
  max = ERROR_PREVIEW_CHARS,
): { text: string; clipped: boolean } {
  const chars = [...error];
  if (chars.length <= max) return { text: error, clipped: false };
  const head = chars.slice(0, max).join("");
  const space = head.lastIndexOf(" ");
  const cut = space > max * 0.75 ? head.slice(0, space) : head;
  return { text: `${cut.trimEnd()}…`, clipped: true };
}

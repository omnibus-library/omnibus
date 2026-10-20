import type { SmtpConfigStatus, SmtpConfigUpdate } from "../../api";

/** The relay form's fields as typed; the port stays text until a save reads it. */
export type SmtpDraft = {
  host: string;
  port: string;
  username: string;
  fromEmail: string;
  password: string;
  security: SmtpConfigStatus["security"];
};

const FIELDS = [
  "host",
  "port",
  "username",
  "fromEmail",
  "password",
  "security",
] as const satisfies readonly (keyof SmtpDraft)[];

/** Whether the form holds an edit that a save has not taken. */
export const isSmtpEdited = (saved: SmtpDraft, draft: SmtpDraft) =>
  FIELDS.some((field) => saved[field] !== draft[field]);

/** What the form holds before any relay is set up. */
export const BLANK_SMTP_DRAFT: SmtpDraft = {
  host: "",
  port: "587",
  username: "",
  fromEmail: "",
  password: "",
  security: "starttls",
};

/** The form as the server's saved relay fills it; the password is never read back. */
export const smtpDraftOf = (config: SmtpConfigStatus): SmtpDraft => ({
  host: config.host ?? "",
  port: config.port?.toString() ?? BLANK_SMTP_DRAFT.port,
  username: config.username ?? "",
  fromEmail: config.from_email ?? "",
  password: "",
  security: config.security,
});

/** The update a Save would send, or the sentence saying why it must not go out. */
export type SmtpUpdate =
  | { refused: string }
  | { refused: null; update: SmtpConfigUpdate };

/**
 * Save writes every field, so it waits for the loaded relay: blanks saved over
 * a failed read would wipe it. A blank password keeps the stored one.
 */
export function smtpUpdate(loaded: boolean, draft: SmtpDraft): SmtpUpdate {
  if (!loaded) {
    return {
      refused:
        "The current SMTP settings haven’t loaded, so saving now would overwrite them.",
    };
  }
  const port = draft.port.trim();
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { refused: "Port must be a number between 1 and 65535." };
  }
  return {
    refused: null,
    update: {
      host: draft.host.trim(),
      port: Number(port),
      username: draft.username.trim(),
      from_email: draft.fromEmail.trim(),
      security: draft.security,
      ...(draft.password !== "" && { password: draft.password }),
    },
  };
}

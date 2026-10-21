import { z } from "zod";
import type { SmtpConfigStatus, SmtpConfigUpdate } from "../../api";

const isPort = (port: string) =>
  /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;

/** The relay form, field by field as the inputs name them, read into the update a Save sends; a blank password keeps the stored one. */
export const SmtpSchema = z
  .object({
    smtp_host: z.string().trim(),
    smtp_port: z
      .string()
      .trim()
      .refine(isPort, "Port must be a number between 1 and 65535.")
      .transform(Number),
    smtp_security: z.enum(["starttls", "tls"]),
    smtp_username: z.string().trim(),
    smtp_password: z.string(),
    smtp_from_email: z.string().trim(),
  })
  .transform(
    (fields): SmtpConfigUpdate => ({
      host: fields.smtp_host,
      port: fields.smtp_port,
      username: fields.smtp_username,
      from_email: fields.smtp_from_email,
      security: fields.smtp_security,
      ...(fields.smtp_password !== "" && { password: fields.smtp_password }),
    }),
  );

/** The relay form's fields as typed; the port stays text until a save reads it. */
export type SmtpDraft = z.input<typeof SmtpSchema>;

/** What the form holds before any relay is set up. */
export const BLANK_SMTP_DRAFT: SmtpDraft = {
  smtp_host: "",
  smtp_port: "587",
  smtp_security: "starttls",
  smtp_username: "",
  smtp_password: "",
  smtp_from_email: "",
};

/** The form as the server's saved relay fills it; the password is never read back. */
export const smtpDraftOf = (config: SmtpConfigStatus): SmtpDraft => ({
  smtp_host: config.host ?? "",
  smtp_port: config.port?.toString() ?? BLANK_SMTP_DRAFT.smtp_port,
  smtp_security: config.security,
  smtp_username: config.username ?? "",
  smtp_password: "",
  smtp_from_email: config.from_email ?? "",
});

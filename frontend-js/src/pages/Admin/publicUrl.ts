import type { PublicUrlStatus } from "../../api";
import type { Status } from "../../components/SettingsShell/SettingsShell";
import { capitalize } from "../../format";

/** The variable a deployment sets the public URL with, named where the card says the value came from. */
export const PUBLIC_URL_ENV = "OMNIBUS_PUBLIC_URL";

/** What the field holds before any edit: the URL saved here, else nothing, since an environment value isn't the field's to change. */
export const publicUrlFieldOf = (status: PublicUrlStatus | undefined) =>
  status?.source === "settings" ? (status.url ?? "") : "";

/** The line beside the status dot once the read lands; empty until then. */
export function publicUrlDetail(status: PublicUrlStatus | undefined): string {
  switch (status?.source) {
    case "settings":
      return "Saved here";
    case "env":
      return `Set by the server’s environment (${PUBLIC_URL_ENV})`;
    default:
      return "";
  }
}

/** The hint under the field while the environment's URL is the one in effect; null otherwise. */
export function environmentHint(
  status: PublicUrlStatus | undefined,
): string | null {
  if (status?.source !== "env" || !status.url) return null;
  return `${status.url} is in effect, from the server’s environment. A URL saved here takes its place.`;
}

/** What the card says once a clear lands: an environment value may take over. */
export function clearedMessage(status: PublicUrlStatus): Status {
  return {
    message:
      status.source === "env"
        ? "Saved URL cleared. The server’s environment value is in effect again."
        : "Public URL cleared. Notifications send without a link.",
    error: false,
  };
}

/** The server's reason for refusing a URL as a sentence: it names the field "public url". */
export const refusalText = (message: string) =>
  capitalize(message.replace(/^public url\b/i, "the public URL"));

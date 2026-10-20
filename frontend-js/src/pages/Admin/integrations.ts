import type { EbookConvertStatus, SecretKeyKind } from "../../api";
import type { Status } from "../../components/SettingsShell/SettingsShell";

/** What a server-wide key card says, and the ids and test ids its controls carry. */
export const SECRET_KEYS = {
  hardcover: {
    noun: "Hardcover",
    heading: "Hardcover suggestions",
    subtitle: "Connect Hardcover to power “Readers also enjoyed”.",
    label: "Hardcover API key",
    inputId: "hardcover-key",
    inputName: "hardcover_api_key",
    placeholder: "hc_live_…",
    testId: "hardcover",
    clearConsequence:
      "“Readers also enjoyed” suggestions stop until a new key is saved.",
  },
  "google-books": {
    noun: "Google Books",
    heading: "Google Books lookup",
    subtitle:
      "Add a Google Books API key so ISBN check-ins keep resolving past the shared anonymous quota.",
    label: "Google Books API key",
    inputId: "google-books-key",
    inputName: "google_books_api_key",
    placeholder: "AIza…",
    testId: "google-books",
    clearConsequence:
      "ISBN check-ins fall back to the shared anonymous quota, which runs out quickly.",
  },
} as const satisfies Record<SecretKeyKind, object>;

/** What removing a key stops. A removed key can't be read back, so the admin needs the original to restore it. */
export const clearWarning = (kind: SecretKeyKind) =>
  `${SECRET_KEYS[kind].clearConsequence} The key can’t be shown again, so you’ll need the original to put it back.`;

/** The command the server runs when no path is saved: `ebook-convert` found on its `PATH`. */
const DEFAULT_EBOOK_CONVERT_BIN = "ebook-convert";

/** The path input's placeholder: the resolved command once the status lands, else the bare name the server falls back to. */
export const ebookConvertPlaceholder = (
  status: EbookConvertStatus | undefined,
) => status?.path ?? DEFAULT_EBOOK_CONVERT_BIN;

/** Whether a saved path, not the environment or `PATH`, is in force: the only case "Use auto-detection" has something to clear. */
export const isOverridden = (status: EbookConvertStatus | undefined) =>
  status?.source === "settings";

/** The line beside the status dot; empty until the status lands. */
export const ebookConvertDetail = (status: EbookConvertStatus | undefined) =>
  status ? `Detected · ${status.source} · ${status.path}` : "";

/** The result of a save the server accepted: a path it cannot run is a warning, not a success. */
export function saveOutcomeMessage(available: boolean): Status {
  return available
    ? { message: "ebook-convert path saved.", error: false }
    : {
        message: "Path saved, but ebook-convert is not runnable there.",
        error: true,
      };
}

/** Where a credential's read stands: still out, failed, or answered as set or unset. */
export type CredentialState =
  | "checking"
  | "unavailable"
  | "configured"
  | "unconfigured";

/** `configured` is undefined until the read answers; `failed` says it never will. */
export function credentialState(
  configured: boolean | undefined,
  failed: boolean,
): CredentialState {
  if (configured === undefined) return failed ? "unavailable" : "checking";
  return configured ? "configured" : "unconfigured";
}

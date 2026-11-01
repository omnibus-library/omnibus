import type { MetadataProvider } from "../data/metadataKeys";
import type { LibrarySettings } from "../data/settings";
import {
  type ExpectMutationOptions,
  type ForcedRequest,
  post,
} from "../utils/api";

/** The endpoints the Administration sections read and write. */
export const settingsUrls = {
  settings: /\/api\/settings(?:\?|$)/,
  smtp: /\/api\/smtp(?:\?|$)/,
  smtpClear: /\/api\/smtp\/clear(?:\?|$)/,
  metadataPrecedence:
    /\/api\/settings\/metadata-precedence\/(?:ebook|audiobook)(?:\?|$)/,
  mcp: /\/api\/settings\/mcp(?:\?|$)/,
  scanLibrary: /\/api\/scan-library(?:\?|$)/,
  rewriteAllEpubs: /\/api\/admin\/rewrite-all-epubs(?:\?|$)/,
  metadataKey: {
    hardcover: /\/api\/hardcover-key(?:\?|$)/,
    "google-books": /\/api\/google-books-key(?:\?|$)/,
  } satisfies Record<MetadataProvider, RegExp>,
};

/** The requests an admin makes from the Administration sections. */
export const settings = {
  /** The read the library form fills itself from. */
  load: (): ForcedRequest => ({ method: "GET", url: settingsUrls.settings }),

  saveLibrary: (
    library: LibrarySettings,
    status = 200,
  ): ExpectMutationOptions =>
    post(
      settingsUrls.settings,
      { ...library, scan_interval_hours: library.scan_interval_hours ?? null },
      status,
    ),

  saveSmtp: (): ExpectMutationOptions => post(settingsUrls.smtp),

  scanLibrary: (): ExpectMutationOptions => post(settingsUrls.scanLibrary),

  rewriteAllEpubs: (): ExpectMutationOptions =>
    post(settingsUrls.rewriteAllEpubs),

  /** A save of `library`'s order, which the address names. */
  saveMetadataPrecedence: (
    library: "ebook" | "audiobook",
  ): ExpectMutationOptions =>
    post(new RegExp(`/api/settings/metadata-precedence/${library}(?:\\?|$)`)),

  setMcp: (enabled: boolean): ExpectMutationOptions =>
    post(settingsUrls.mcp, { enabled }, 204),

  /** Saves `key`, or clears the provider's key when it is null. */
  saveMetadataKey: (
    provider: MetadataProvider,
    key: string | null,
  ): ExpectMutationOptions => post(settingsUrls.metadataKey[provider], { key }),
};

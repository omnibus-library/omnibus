import type { MetadataProvider } from "../data/metadataKeys";
import type { LibrarySettings } from "../data/settings";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoints the Administration sections post to. */
export const settingsUrls = {
  save: /\/api\/rpc\/settings(?:\?|$)/,
  smtp: /\/api\/rpc\/smtp(?:\?|$)/,
  smtpClear: /\/api\/rpc\/smtp\/clear(?:\?|$)/,
  metadataPrecedence: /\/api\/rpc\/metadata-precedence\/set(?:\?|$)/,
  mcp: /\/api\/settings\/mcp(?:\?|$)/,
  scanLibrary: /\/api\/rpc\/scan-library(?:\?|$)/,
  rewriteAllEpubs: /\/api\/rpc\/admin\/rewrite-all-epubs(?:\?|$)/,
  metadataKey: {
    hardcover: /\/api\/rpc\/hardcover-key(?:\?|$)/,
    "google-books": /\/api\/rpc\/google-books-key(?:\?|$)/,
  } satisfies Record<MetadataProvider, RegExp>,
};

/** The writes an admin makes from the Administration sections. */
export const settings = {
  saveLibrary: (
    library: LibrarySettings,
    status = 200,
  ): ExpectMutationOptions =>
    post(settingsUrls.save, { settings: library }, status),

  saveSmtp: (): ExpectMutationOptions => post(settingsUrls.smtp),

  scanLibrary: (): ExpectMutationOptions => post(settingsUrls.scanLibrary),

  rewriteAllEpubs: (): ExpectMutationOptions =>
    post(settingsUrls.rewriteAllEpubs),

  saveMetadataPrecedence: (): ExpectMutationOptions =>
    post(settingsUrls.metadataPrecedence),

  setMcp: (enabled: boolean): ExpectMutationOptions =>
    post(settingsUrls.mcp, { enabled }, 204),

  /** Saves `key`, or clears the provider's key when it is null. */
  saveMetadataKey: (
    provider: MetadataProvider,
    key: string | null,
  ): ExpectMutationOptions => post(settingsUrls.metadataKey[provider], { key }),
};

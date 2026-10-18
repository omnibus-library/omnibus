import type { MetadataProvider } from "../data/metadataKeys";
import type { LibrarySettings } from "../data/settings";
import type { ExpectMutationOptions } from "../utils/api";

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
  ): ExpectMutationOptions => ({
    method: "POST",
    url: settingsUrls.save,
    expectedBody: { settings: library },
    expectedStatus: status,
  }),

  saveSmtp: (): ExpectMutationOptions => ({
    method: "POST",
    url: settingsUrls.smtp,
    expectedStatus: 200,
  }),

  scanLibrary: (): ExpectMutationOptions => ({
    method: "POST",
    url: settingsUrls.scanLibrary,
    expectedStatus: 200,
  }),

  rewriteAllEpubs: (): ExpectMutationOptions => ({
    method: "POST",
    url: settingsUrls.rewriteAllEpubs,
    expectedStatus: 200,
  }),

  saveMetadataPrecedence: (): ExpectMutationOptions => ({
    method: "POST",
    url: settingsUrls.metadataPrecedence,
    expectedStatus: 200,
  }),

  setMcp: (enabled: boolean): ExpectMutationOptions => ({
    method: "POST",
    url: settingsUrls.mcp,
    expectedBody: { enabled },
    expectedStatus: 204,
  }),

  /** Saves `key`, or clears the provider's key when it is null. */
  saveMetadataKey: (
    provider: MetadataProvider,
    key: string | null,
  ): ExpectMutationOptions => ({
    method: "POST",
    url: settingsUrls.metadataKey[provider],
    expectedBody: { key },
    expectedStatus: 200,
  }),
};

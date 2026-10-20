import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  getBackgroundTasks,
  getLibrary,
  getPostBackfillChaptersUrl,
  getPostRefetchAuthorPhotosUrl,
  getPostRewriteAllEpubsUrl,
  getPostScanLibraryUrl,
  getSettings,
  getWorkerStatus,
  postSettings,
} from "./generated/omnibus";
import type { Settings } from "./generated/schemas";

export type {
  BackgroundTaskRecord,
  GhostFilesWarning,
  LibraryContents,
  LibrarySection,
  ScanTallies,
  Settings,
  TaskKind,
  TaskProgress,
} from "./generated/schemas";

// The server-administration reads and writes. Every answer stays wire-shaped,
// and every query key starts with "admin" so one prefix covers the section.

/** The library folders and rescan interval the server holds. */
export const settingsQuery = queryOptions({
  queryKey: ["admin", "settings"],
  queryFn: async () => ok(await getSettings()),
});

/** What the scanner finds in each library folder, by extension. */
export const libraryContentsQuery = queryOptions({
  queryKey: ["admin", "library"],
  queryFn: async () => ok(await getLibrary()),
});

/** Replaces the library settings; answers what the server now holds. */
export async function saveSettings(settings: Settings): Promise<Settings> {
  return ok(await postSettings(settings));
}

// A job's route answers with no body, so the generated fetcher would JSON-parse a refusal's plain text.
async function queue(url: string) {
  await send(url, "POST");
}

/** Queues a scan of both library folders. */
export const scanLibrary = () => queue(getPostScanLibraryUrl());

/** Queues a fresh Open Library lookup of every author photo. */
export const refetchAuthorPhotos = () => queue(getPostRefetchAuthorPhotosUrl());

/** Queues reading the chapter markers of audiobooks that have none. */
export const backfillChapters = () => queue(getPostBackfillChaptersUrl());

/** Queues rebuilding every edited EPUB's download copy. */
export const rewriteAllEpubs = () => queue(getPostRewriteAllEpubsUrl());

/** The worker's task feed, read once a second while a screen shows it. */
export const workerStatusQuery = queryOptions({
  queryKey: ["admin", "worker-status"],
  queryFn: async () => ok(await getWorkerStatus()),
  refetchInterval: 1_000,
});

/** The recorded runs of background tasks, newest first. */
export const backgroundTasksQuery = queryOptions({
  queryKey: ["admin", "background-tasks"],
  queryFn: async () => ok(await getBackgroundTasks()),
});

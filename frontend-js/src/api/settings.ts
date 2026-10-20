import { queryOptions } from "@tanstack/react-query";
import { ok, send } from "./core";
import {
  getBackgroundTasks,
  getLibrary,
  getMetadataPrecedence,
  getPostBackfillChaptersUrl,
  getPostRefetchAuthorPhotosUrl,
  getPostRewriteAllEpubsUrl,
  getPostScanLibraryUrl,
  getSettings,
  getWorkerStatus,
  postMetadataPrecedence,
  postSettings,
} from "./generated/omnibus";
import type { MetadataSource, Settings } from "./generated/schemas";

export type {
  BackgroundTaskRecord,
  GhostFilesWarning,
  LibraryContents,
  LibrarySection,
  MetadataSource,
  ScanTallies,
  Settings,
  TaskKind,
  TaskProgress,
  WorkerStatus as WorkerFeed,
} from "./generated/schemas";

export type MetadataLibrary = "ebook" | "audiobook";

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

/** A library's metadata sources, lowest priority first; the default order until its folder is set. */
export const metadataOrderQuery = (library: MetadataLibrary) =>
  queryOptions({
    queryKey: ["admin", "metadata-order", library],
    queryFn: async () => ok(await getMetadataPrecedence(library)),
  });

/** Saves a library's order; answers what the server now holds. */
export async function saveMetadataOrder(
  library: MetadataLibrary,
  order: readonly MetadataSource[],
): Promise<MetadataSource[]> {
  return ok(await postMetadataPrecedence(library, [...order]));
}

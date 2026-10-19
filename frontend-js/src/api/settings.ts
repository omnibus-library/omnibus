import { queryOptions } from "@tanstack/react-query";
import { ok } from "./core";
import { getLibrary, getSettings, postSettings } from "./generated/omnibus";
import type { Settings } from "./generated/schemas";

export type {
  LibraryContents,
  LibrarySection,
  Settings,
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

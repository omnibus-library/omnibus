import type { LibrarySection, Settings } from "../../api";
import { plural } from "../../format";

/** Mirrors `SCAN_INTERVAL_MIN_HOURS` in `shared/src/settings.rs`; the server enforces it. */
export const SCAN_INTERVAL_MIN_HOURS = 1;

// The largest hours value the server's `u32` reads.
const U32_MAX = 4294967295;

/** The settings a Save would write, or why it must not go out. */
export type SourcesPayload =
  | { refused: "not-loaded" }
  | { refused: "bad-interval" }
  | { refused: null; settings: Settings };

const blankToNull = (value: string) => value.trim() || null;

/**
 * Save writes every field, so it waits for the loaded settings: blank fields
 * saved over a failed read would clear both library paths.
 */
export function sourcesPayload(
  loaded: boolean,
  ebook: string,
  audiobook: string,
  interval: string,
): SourcesPayload {
  if (!loaded) return { refused: "not-loaded" };
  const hours = interval.trim();
  if (hours && !(/^\d+$/.test(hours) && Number(hours) <= U32_MAX)) {
    return { refused: "bad-interval" };
  }
  return {
    refused: null,
    settings: {
      ebook_library_path: blankToNull(ebook),
      audiobook_library_path: blankToNull(audiobook),
      scan_interval_hours: hours ? Number(hours) : null,
    },
  };
}

/** "5 files found. 4 .epub found. 1 .pdf found." */
export function librarySummaryLine(section: LibrarySection): string {
  const files = `${section.total_files} file${plural(section.total_files)} found.`;
  return section.counts_by_ext.reduce(
    (line, [ext, count]) => `${line} ${count} .${ext} found.`,
    files,
  );
}

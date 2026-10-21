import { z } from "zod";
import type { LibrarySection, Settings } from "../../api";
import { noneIfBlank, plural } from "../../format";

/** Mirrors `SCAN_INTERVAL_MIN_HOURS` in `shared/src/settings.rs`; the server enforces it. */
export const SCAN_INTERVAL_MIN_HOURS = 1;

// The largest hours value the server's `u32` reads.
const U32_MAX = 4294967295;

export const INTERVAL_MESSAGE =
  "Enter a whole number of hours, or leave it blank.";

const isHours = (hours: string) =>
  hours === "" || (/^\d+$/.test(hours) && Number(hours) <= U32_MAX);

/** The library form, field by field as the inputs name them, read into the settings a Save writes; a blank path or interval saves as none. */
export const SourcesSchema = z.object({
  ebook_library_path: z.string().transform(noneIfBlank),
  audiobook_library_path: z.string().transform(noneIfBlank),
  scan_interval_hours: z
    .string()
    .trim()
    .refine(isHours, INTERVAL_MESSAGE)
    .transform((hours) => (hours ? Number(hours) : null)),
}) satisfies z.ZodType<Settings, Record<keyof Settings, string>>;

/** "5 files found. 4 .epub found. 1 .pdf found." */
export function librarySummaryLine(section: LibrarySection): string {
  const files = `${section.total_files} file${plural(section.total_files)} found.`;
  return section.counts_by_ext.reduce(
    (line, [ext, count]) => `${line} ${count} .${ext} found.`,
    files,
  );
}

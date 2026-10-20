import { z } from "zod";
import { loadScript, parseWith } from "../../loadScript";
import epubUrl from "../../vendor/reader/epub.min.js?url";
import glueUrl from "../../vendor/reader/epub-reader-glue.js?url";
import jszipUrl from "../../vendor/reader/jszip.min.js?url";

// Loaded by <script>, not bundled: epub.js and the glue read the globals JSZip and ePub declare.
let loading: Promise<void> | undefined;

/** Loads JSZip, epub.js, then the glue, once per page; a global already on the page skips its script. */
export function loadEpubRuntime(): Promise<void> {
  if (window.OmnibusReader) return Promise.resolve();
  loading ??= (async () => {
    if (!window.JSZip) await loadScript(jszipUrl);
    if (!window.ePub) await loadScript(epubUrl);
    await loadScript(glueUrl);
  })();
  // A failed load stays retryable, and only what failed loads again.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}

/** Runs `fn` on the glue once it has loaded; calls made before then run after it, in call order. */
export function withReader(
  fn: (glue: NonNullable<Window["OmnibusReader"]>) => void,
): void {
  loadEpubRuntime().then(
    () => {
      if (window.OmnibusReader) fn(window.OmnibusReader);
    },
    // The mount effect reports a failed load; a queued call has nothing to run on.
    () => {},
  );
}

const RelocateSchema = z.object({
  cfi: z.string().nullable().default(null),
  // Visual page within the current spine section, not the whole book.
  page: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
  // Whole-book percent; `pctApprox` flags the glue's coarse stand-in before its locations map resolves.
  pct: z.int().nonnegative(),
  frac: z.number().default(0),
  pctApprox: z.boolean().default(false),
  // The displayed range reaches the book's end; `pct` tracks the range's start and never gets there.
  atEnd: z.boolean().default(false),
  chapter: z.int().nonnegative(),
  totalChapters: z.int().nonnegative(),
  chapterTitle: z.string(),
  // The glue re-stating a position the host already holds, not movement.
  echo: z.boolean().default(false),
});

/** One position report from the glue's `relocated` event. */
export type Relocate = z.infer<typeof RelocateSchema>;

const TocSchema = z.array(
  z.object({
    label: z.string(),
    href: z.string(),
    level: z.int().nonnegative().default(0),
  }),
);

/** One flattened table-of-contents entry; `level` is the nesting depth, 0 at the top. */
export type TocEntry = z.infer<typeof TocSchema>[number];

const SearchResultsSchema = z.array(
  z.object({
    cfi: z.string(),
    excerpt: z.string().default(""),
    chapter: z.string().default(""),
  }),
);

/** One in-book search match: where it is, the text around it and the chapter it sits in. */
export type SearchResult = z.infer<typeof SearchResultsSchema>[number];

const SelectionSchema = z.object({
  cfiRange: z.string(),
  text: z.string().default(""),
  // In viewport coordinates, which is what the popover is placed by.
  rect: z.object({ x: z.number(), y: z.number(), width: z.number() }),
});

/** The passage the reader selected: its range CFI, its text and where it sits on screen. */
export type PassageSelection = z.infer<typeof SelectionSchema>;

export const parseRelocate = (json: string) => parseWith(RelocateSchema, json);
export const parseToc = (json: string) => parseWith(TocSchema, json);
export const parseSelection = (json: string) =>
  parseWith(SelectionSchema, json);
export const parseSearchResults = (json: string) =>
  parseWith(SearchResultsSchema, json);

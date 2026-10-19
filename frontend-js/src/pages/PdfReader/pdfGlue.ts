import { z } from "zod";
import { loadScript, parseWith } from "../../loadScript";
import pdfjsUrl from "../../vendor/reader/pdf.min.mjs?url";
import workerUrl from "../../vendor/reader/pdf.worker.min.mjs?url";
import glueUrl from "../../vendor/reader/pdf-reader-glue.js?url";
import { encodePdfAnchor } from "./pdfAnchors";

/**
 * What the glue's `init` is given: PDF.js and its worker are modules the glue `import()`s itself,
 * and PDF.js fetches `${wasmUrl}openjpeg.wasm`, so the decoders keep their names under `public/`.
 */
export const PDF_RUNTIME = {
  pdfjs: pdfjsUrl,
  worker: workerUrl,
  wasmUrl: `${import.meta.env.BASE_URL}vendor/pdfjs-wasm/`,
};

let loading: Promise<void> | undefined;

/** Loads the glue once per page; a glue already on the page skips the script. */
export function loadPdfGlue(): Promise<void> {
  if (window.OmnibusPdfReader) return Promise.resolve();
  loading ??= loadScript(glueUrl);
  // A failed load stays retryable.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}

// The glue's position report: the 0-based page showing and PDF.js's own page count.
const PositionSchema = z.object({
  page: z.int().nonnegative(),
  pageCount: z.int().nonnegative(),
});

const SelectionSchema = z
  .object({
    page: z.int().nonnegative(),
    // One quad per selected line fragment, in PDF points on the unrotated page.
    quads: z.array(z.array(z.number()).length(8)).default([]),
    text: z.string().default(""),
    // In reader coordinates, which is what the popover is placed by.
    rect: z.object({ x: z.number(), y: z.number(), width: z.number() }),
  })
  .transform(({ page, quads, text, rect }) => ({
    anchor: encodePdfAnchor(page, quads),
    text,
    rect,
  }));

/** The passage selected on the text layer: the `pdf:` anchor it is saved under, its text and where it sits. */
export type PdfSelection = z.infer<typeof SelectionSchema>;

export const parsePdfPosition = (json: string) =>
  parseWith(PositionSchema, json);
export const parsePdfSelection = (json: string) =>
  parseWith(SelectionSchema, json);

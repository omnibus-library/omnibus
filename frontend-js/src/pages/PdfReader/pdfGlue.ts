import { z } from "zod";
import { loadScript } from "../../loadScript";
import pdfjsUrl from "../../vendor/reader/pdf.min.mjs?url";
import workerUrl from "../../vendor/reader/pdf.worker.min.mjs?url";
import glueUrl from "../../vendor/reader/pdf-reader-glue.js?url";

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

const PositionSchema = z.object({
  page: z.int().nonnegative(),
  pageCount: z.int().nonnegative(),
});

/** The glue's position report: the 0-based page showing and PDF.js's own page count. */
export type PdfPosition = z.infer<typeof PositionSchema>;

/** Reads a glue payload, which is untrusted vendor output; `null` for one that doesn't match, so it is dropped. */
export function parsePdfPosition(json: string): PdfPosition | null {
  try {
    return PositionSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

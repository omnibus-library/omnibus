import { loadScript } from "../../loadScript";
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

/** One call a page made on a stand-in glue. */
export type GlueCall = { method: string; args: unknown[] };

type PdfInit = Parameters<NonNullable<Window["OmnibusPdfReader"]>["init"]>[1];

/**
 * Installs a stand-in `window.OmnibusPdfReader` that records every call. Its presence makes
 * `loadPdfGlue` skip the script, so no real PDF.js runs. `init` plays `onInit`, by default
 * Ready at the start page of `pageCount` pages; `goTo` answers with the Page report the real glue sends.
 */
export function fakePdfGlue({
  pageCount = 5,
  onInit,
}: {
  pageCount?: number;
  onInit?: (opts: PdfInit) => void;
} = {}) {
  const calls: GlueCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  window.OmnibusPdfReader = {
    init(hostId, opts) {
      calls.push({ method: "init", args: [hostId, opts] });
      if (onInit) return onInit(opts);
      window.__omnibusOnPdfReady?.(
        JSON.stringify({ page: opts.startPage, pageCount }),
      );
    },
    goTo(page) {
      calls.push({ method: "goTo", args: [page] });
      window.__omnibusOnPdfPage?.(JSON.stringify({ page, pageCount }));
    },
    retry: record("retry"),
    destroy: record("destroy"),
    next: record("next"),
    prev: record("prev"),
    setFit: record("setFit"),
    paintHighlights: record("paintHighlights"),
    clearSelection: record("clearSelection"),
    copyText: record("copyText"),
    shareText: record("shareText"),
  };
  return {
    calls,
    restore() {
      delete window.OmnibusPdfReader;
    },
  };
}

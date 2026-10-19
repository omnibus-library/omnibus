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

type EpubGlue = NonNullable<Window["OmnibusReader"]>;
type EpubInit = Parameters<EpubGlue["init"]>[2];

/** The glue's relocate payload for a book of 20 pages and 3 chapters, with `overrides` laid over it. */
export function epubRelocate(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    cfi: "epubcfi(/6/2!/4/2/1:0)",
    page: 1,
    totalPages: 20,
    pct: 5,
    frac: 0.05,
    pctApprox: false,
    atEnd: false,
    chapter: 1,
    totalChapters: 3,
    chapterTitle: "",
    echo: false,
    ...overrides,
  });
}

/**
 * Installs a stand-in `window.OmnibusReader` that records every call. Its presence makes the
 * loader skip the scripts, so no epub.js runs. `init` plays `onInit`, by default the TOC, a
 * relocate at the CFI it was given (an echo, as a restore is) and `ready`; `next` and `prev`
 * answer with the relocate a real turn sends.
 */
export function fakeEpubGlue({
  toc = [],
  onInit,
}: {
  toc?: { label: string; href: string; level: number }[];
  onInit?: (opts: EpubInit) => void;
} = {}) {
  const calls: GlueCall[] = [];
  let page = 1;
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const turn = (to: number) => {
    page = Math.max(to, 1);
    window.__omnibusOnRelocate?.(
      epubRelocate({
        cfi: `epubcfi(/6/${page * 2}!/4/2/1:0)`,
        page,
        pct: page * 5,
      }),
    );
  };
  window.OmnibusReader = {
    init(elementId, fileUrl, opts) {
      calls.push({ method: "init", args: [elementId, fileUrl, opts] });
      if (onInit) return onInit(opts);
      window.__omnibusOnToc?.(JSON.stringify(toc));
      window.__omnibusOnRelocate?.(
        epubRelocate({
          ...(typeof opts.cfi === "string" && { cfi: opts.cfi }),
          echo: typeof opts.cfi === "string",
          chapterTitle: toc[0]?.label ?? "",
          totalChapters: toc.length,
        }),
      );
      window.__omnibusOnStatus?.("ready");
    },
    next() {
      calls.push({ method: "next", args: [] });
      turn(page + 1);
    },
    prev() {
      calls.push({ method: "prev", args: [] });
      turn(page - 1);
    },
    retry: record("retry"),
    destroy: record("destroy"),
    setFontSize: record("setFontSize"),
    setTheme: record("setTheme"),
    setFont: record("setFont"),
    setLineHeight: record("setLineHeight"),
    setMargins: record("setMargins"),
    setJustify: record("setJustify"),
    setSpread: record("setSpread"),
    addAnnotation: record("addAnnotation"),
    removeAnnotation: record("removeAnnotation"),
    display: record("display"),
    displayCfi: record("displayCfi"),
    displayPercentage: record("displayPercentage"),
    copyText: record("copyText"),
    shareText: record("shareText"),
    search: record("search"),
  };
  return {
    calls,
    restore() {
      delete window.OmnibusReader;
    },
  };
}

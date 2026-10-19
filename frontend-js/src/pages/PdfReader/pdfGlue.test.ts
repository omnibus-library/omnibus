import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps its loading promise across calls, so each test imports a fresh copy.
async function fresh() {
  vi.resetModules();
  return import("./pdfGlue");
}

const scripts = () => [...document.head.querySelectorAll("script")];

/** Lets the next appended script load, or fail. */
function settle(
  script: HTMLScriptElement | undefined,
  event: "load" | "error",
) {
  script?.dispatchEvent(new Event(event));
}

describe("loadPdfGlue", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  afterEach(() => {
    delete window.OmnibusPdfReader;
  });

  it("loads the glue once for every call", async () => {
    const { loadPdfGlue } = await fresh();

    const loaded = loadPdfGlue();
    expect(loadPdfGlue()).toBe(loaded);
    settle(scripts()[0], "load");

    await expect(loaded).resolves.toBeUndefined();
    expect(scripts().map((s) => s.src)).toEqual([
      expect.stringContaining("pdf-reader-glue"),
    ]);
  });

  it("resolves at once with no script when the glue is already on the page", async () => {
    window.OmnibusPdfReader = {} as NonNullable<Window["OmnibusPdfReader"]>;
    const { loadPdfGlue } = await fresh();

    await expect(loadPdfGlue()).resolves.toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it("tries again on the next call after a failure", async () => {
    const { loadPdfGlue } = await fresh();
    const failed = loadPdfGlue();
    settle(scripts()[0], "error");
    await expect(failed).rejects.toThrow("failed to load");

    loadPdfGlue();

    expect(scripts()).toHaveLength(2);
  });
});

describe("PDF_RUNTIME", () => {
  it("ends the decoder directory in a slash, which PDF.js appends file names to", async () => {
    const { PDF_RUNTIME } = await fresh();

    expect(PDF_RUNTIME.wasmUrl.endsWith("/")).toBe(true);
  });
});

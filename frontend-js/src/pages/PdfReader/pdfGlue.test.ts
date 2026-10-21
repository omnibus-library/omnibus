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

describe("parsePdfSelection", () => {
  const rect = { x: 10, y: 20, width: 30 };

  it("turns the glue's payload into the anchor it is saved under", async () => {
    const { parsePdfSelection } = await fresh();

    expect(
      parsePdfSelection(
        JSON.stringify({
          page: 1,
          quads: [[1, 2, 3, 4, 5, 6, 7, 8]],
          text: "t",
          rect,
        }),
      ),
    ).toEqual({
      anchor: "pdf:1:1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0",
      text: "t",
      rect,
    });
  });

  it.each([
    ["text that is not json", "not json"],
    ["a payload with no rect", JSON.stringify({ page: 1 })],
    [
      "a quad of seven numbers",
      JSON.stringify({ page: 1, quads: [[1, 2, 3, 4, 5, 6, 7]], rect }),
    ],
  ])("drops %s", async (_condition, json) => {
    const { parsePdfSelection } = await fresh();

    expect(parsePdfSelection(json)).toBeNull();
  });
});

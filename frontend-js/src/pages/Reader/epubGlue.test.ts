import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps its loading promise across calls, so each test imports a fresh copy.
async function fresh() {
  vi.resetModules();
  return import("./epubGlue");
}

const scripts = () => [...document.head.querySelectorAll("script")];

/** Lets the next appended script load, or fail. */
function settle(
  script: HTMLScriptElement | undefined,
  event: "load" | "error",
) {
  script?.dispatchEvent(new Event(event));
}

function stubReader() {
  return {
    next: vi.fn(),
    prev: vi.fn(),
  } as unknown as NonNullable<Window["OmnibusReader"]>;
}

describe("loadEpubRuntime", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  afterEach(() => {
    delete window.JSZip;
    delete window.ePub;
    delete window.OmnibusReader;
  });

  it("loads JSZip, then epub.js, then the glue", async () => {
    const { loadEpubRuntime } = await fresh();

    const loaded = loadEpubRuntime();
    expect(scripts().map((s) => s.src)).toEqual([
      expect.stringContaining("jszip.min"),
    ]);
    settle(scripts()[0], "load");
    await vi.waitFor(() => expect(scripts()).toHaveLength(2));
    expect(scripts()[1]?.src).toContain("epub.min");
    settle(scripts()[1], "load");
    await vi.waitFor(() => expect(scripts()).toHaveLength(3));
    expect(scripts()[2]?.src).toContain("epub-reader-glue");
    settle(scripts()[2], "load");

    await expect(loaded).resolves.toBeUndefined();
  });

  it("skips a script whose global is already on the page", async () => {
    window.JSZip = {};
    window.ePub = {};
    const { loadEpubRuntime } = await fresh();

    loadEpubRuntime();

    await vi.waitFor(() => expect(scripts()).toHaveLength(1));
    expect(scripts()[0]?.src).toContain("epub-reader-glue");
  });

  it("reuses one load for every call", async () => {
    const { loadEpubRuntime } = await fresh();

    expect(loadEpubRuntime()).toBe(loadEpubRuntime());
    expect(scripts()).toHaveLength(1);
  });

  it("resolves at once with no script when the glue is already on the page", async () => {
    window.OmnibusReader = stubReader();
    const { loadEpubRuntime } = await fresh();

    await expect(loadEpubRuntime()).resolves.toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it("loads again only what failed on the next call after a failure", async () => {
    const { loadEpubRuntime } = await fresh();
    const failed = loadEpubRuntime();
    window.JSZip = {};
    settle(scripts()[0], "load");
    await vi.waitFor(() => expect(scripts()).toHaveLength(2));
    settle(scripts()[1], "error");
    await expect(failed).rejects.toThrow("failed to load");

    loadEpubRuntime();

    await vi.waitFor(() => expect(scripts()).toHaveLength(3));
    expect(scripts()[2]?.src).toContain("epub.min");
  });
});

describe("withReader", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  afterEach(() => {
    delete window.JSZip;
    delete window.ePub;
    delete window.OmnibusReader;
  });

  it("runs calls made before the glue loaded after it, in call order", async () => {
    window.JSZip = {};
    window.ePub = {};
    const { withReader } = await fresh();
    const order: string[] = [];

    withReader(() => order.push("first"));
    withReader(() => order.push("second"));
    window.OmnibusReader = stubReader();
    settle(scripts()[0], "load");

    await vi.waitFor(() => expect(order).toEqual(["first", "second"]));
  });

  it("hands the call the glue", async () => {
    const reader = stubReader();
    window.OmnibusReader = reader;
    const { withReader } = await fresh();
    const seen = vi.fn();

    withReader(seen);

    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(reader));
  });
});

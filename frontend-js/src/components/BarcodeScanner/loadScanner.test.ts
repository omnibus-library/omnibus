import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps its loading promise across calls, so each test imports a fresh copy.
async function fresh() {
  vi.resetModules();
  return (await import("./loadScanner")).loadScanner;
}

const scripts = () => [...document.head.querySelectorAll("script")];

/** Lets the next appended script load, or fail. */
function settle(
  script: HTMLScriptElement | undefined,
  event: "load" | "error",
) {
  script?.dispatchEvent(new Event(event));
}

describe("loadScanner", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  afterEach(() => {
    delete window.OmnibusScanner;
    delete window.ZXingWASM;
  });

  it("loads zxing then the glue then resolves to the wasm URL", async () => {
    const loadScanner = await fresh();

    const loaded = loadScanner();
    expect(scripts().map((s) => s.src)).toEqual([
      expect.stringContaining("zxing-reader.min"),
    ]);
    settle(scripts()[0], "load");
    await vi.waitFor(() => expect(scripts()).toHaveLength(2));
    expect(scripts()[1]?.src).toContain("barcode-scanner-glue");
    settle(scripts()[1], "load");

    await expect(loaded).resolves.toContain("zxing_reader");
  });

  it("reuses one load for every call", async () => {
    const loadScanner = await fresh();

    expect(loadScanner()).toBe(loadScanner());
    expect(scripts()).toHaveLength(1);
  });

  it("resolves at once when the glue is already on the page", async () => {
    window.OmnibusScanner = {
      start: vi.fn(),
      stop: vi.fn(),
      setTorch: vi.fn(),
    };
    const loadScanner = await fresh();

    await expect(loadScanner()).resolves.toContain("zxing_reader");
    expect(scripts()).toHaveLength(0);
  });

  it("rejects when a script fails", async () => {
    const loadScanner = await fresh();

    const failed = loadScanner();
    settle(scripts()[0], "error");

    await expect(failed).rejects.toThrow("failed to load");
  });

  it("tries again on the next call after a failure", async () => {
    const loadScanner = await fresh();
    const failed = loadScanner();
    settle(scripts()[0], "error");
    await expect(failed).rejects.toThrow("failed to load");

    loadScanner();

    expect(scripts()).toHaveLength(2);
  });
});

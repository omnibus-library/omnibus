import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HlsConstructor } from "./loadHls";

// The module keeps its loading promise across calls, so each test imports a fresh copy.
async function fresh() {
  vi.resetModules();
  return (await import("./loadHls")).loadHls;
}

const scripts = () => [...document.head.querySelectorAll("script")];
const Hls = {} as HlsConstructor;

describe("loadHls", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  afterEach(() => {
    delete window.Hls;
  });

  it("resolves to the global with no script when Hls is already on the page", async () => {
    window.Hls = Hls;
    const loadHls = await fresh();

    await expect(loadHls()).resolves.toBe(Hls);
    expect(scripts()).toHaveLength(0);
  });

  it("appends one script and resolves to the global it defines", async () => {
    const loadHls = await fresh();

    const loaded = loadHls();
    expect(loadHls()).toBe(loaded);
    expect(scripts().map((s) => s.src)).toEqual([
      expect.stringContaining("hls.min"),
    ]);
    window.Hls = Hls;
    scripts()[0]?.dispatchEvent(new Event("load"));

    await expect(loaded).resolves.toBe(Hls);
  });

  it("tries again on the next call after a failed load", async () => {
    const loadHls = await fresh();
    const failed = loadHls();
    scripts()[0]?.dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow("failed to load");

    loadHls();

    expect(scripts()).toHaveLength(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { reloadOnStaleChunk, shouldReload } from "./staleChunk";

describe("shouldReload", () => {
  it.each([
    [null, "build-b", true],
    ["build-a", "build-b", true],
    ["build-b", "build-b", false],
  ])(
    "with %j reloaded and %s running answers %s",
    (reloaded, build, expected) => {
      expect(shouldReload(reloaded, build)).toBe(expected);
    },
  );
});

describe("reloadOnStaleChunk", () => {
  function setup(stored: string | null, online = true) {
    const values = new Map<string, string>();
    if (stored !== null) values.set("omn.chunk-reload", stored);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const reload = vi.fn();
    const event = new Event("vite:preloadError", { cancelable: true });
    const target = new EventTarget();
    reloadOnStaleChunk(target, {
      storage,
      reload,
      build: "build-b",
      online: () => online,
    });
    target.dispatchEvent(event);
    return { values, reload, event };
  }

  it("reloads once and records the build, on the first failed chunk", () => {
    const { values, reload, event } = setup(null);

    expect(reload).toHaveBeenCalledOnce();
    expect(values.get("omn.chunk-reload")).toBe("build-b");
    expect(event.defaultPrevented).toBe(true);
  });

  it("reloads again when an older build did the last reload", () => {
    const { reload } = setup("build-a");

    expect(reload).toHaveBeenCalledOnce();
  });

  it("lets the error surface when this build already reloaded", () => {
    const { reload, event } = setup("build-b");

    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("lets the error surface while offline", () => {
    const { values, reload, event } = setup(null, false);

    expect(reload).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("lets the error surface when storage is unavailable", () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    const target = new EventTarget();
    reloadOnStaleChunk(target, { storage, reload, build: "build-b" });

    target.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

    expect(reload).not.toHaveBeenCalled();
  });
});

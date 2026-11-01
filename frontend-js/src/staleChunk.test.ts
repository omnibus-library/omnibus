import { describe, expect, it, vi } from "vitest";
import { reloadOnStaleChunk, shouldReload } from "./staleChunk";

describe("shouldReload", () => {
  it.each([
    [null, 50_000, true],
    ["30000", 50_000, true],
    ["45000", 50_000, false],
    ["garbage", 50_000, true],
  ])(
    "with a last reload at %j and now %i answers %s",
    (last, now, expected) => {
      expect(shouldReload(last, now)).toBe(expected);
    },
  );
});

describe("reloadOnStaleChunk", () => {
  function setup(stored: string | null) {
    const values = new Map<string, string>();
    if (stored !== null) values.set("omn.chunk-reload", stored);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const reload = vi.fn();
    const event = new Event("vite:preloadError", { cancelable: true });
    const target = new EventTarget();
    reloadOnStaleChunk(target, storage, reload, () => 50_000);
    target.dispatchEvent(event);
    return { values, reload, event };
  }

  it("reloads once and records when, on the first failed chunk", () => {
    const { values, reload, event } = setup(null);

    expect(reload).toHaveBeenCalledOnce();
    expect(values.get("omn.chunk-reload")).toBe("50000");
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets the error surface when it already reloaded a moment ago", () => {
    const { reload, event } = setup("45000");

    expect(reload).not.toHaveBeenCalled();
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
    reloadOnStaleChunk(target, storage, reload, () => 50_000);

    target.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

    expect(reload).not.toHaveBeenCalled();
  });
});

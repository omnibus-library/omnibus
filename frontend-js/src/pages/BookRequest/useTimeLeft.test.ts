import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimeLeft } from "./useTimeLeft";

const START = Date.UTC(2026, 10, 5, 12) / 1000;

describe("useTimeLeft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down while the download's finish time holds", () => {
    const download = { expectedDoneAt: START + 30 * 60, progress: 0.4 };
    const { result } = renderHook(() => useTimeLeft(download));
    expect(result.current).toBe("about 30 min left");

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(result.current).toBe("about 20 min left");
  });
});

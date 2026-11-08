import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNowPast } from "./useNowPast";

const START = Date.UTC(2026, 10, 5, 12) / 1000;
let clock = START;

describe("useNowPast", () => {
  beforeEach(() => {
    clock = START;
    // Only the timers are fake, so a test moves the clock apart from them.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(Date, "now").mockImplementation(() => clock * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads the clock again once the deadline has passed", () => {
    const { result } = renderHook(() => useNowPast(START + 5));
    expect(result.current).toBe(START);

    clock = START + 6;
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(result.current).toBe(START + 6);
  });

  it("keeps waiting when its timer fires before the clock reaches the deadline", () => {
    const { result } = renderHook(() => useNowPast(START + 1));

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(START);

    clock = START + 2;
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current).toBe(START + 2);
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartResult } from "../../api";
import { blend, easeOut, useTweened } from "./tween";

type Slice = [slice: string | null, values: (number | null)[]];

const result = (
  buckets: string[],
  slices: Slice[],
  max = 20,
  overrides: Partial<ChartResult> = {},
): ChartResult => ({
  bucket: "month",
  buckets,
  series: slices.map(([slice, values]) => ({
    measure: "books_finished",
    slice,
    axis: 0,
    mark: "bar",
    values,
  })),
  axes: [{ unit: "books", max }],
  divisions: 4,
  stacked: false,
  truncated: false,
  caveats: [],
  ...overrides,
});

const twoBuckets = (values: (number | null)[], max = 20) =>
  result(["2026-01", "2026-02"], [[null, values]], max);

// jsdom has no matchMedia, so the system's motion setting is whatever a test says it is.
const stubReducedMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce,
    media: query,
  }));

describe("blend", () => {
  it("starts at the old values and ends at the new", () => {
    const a = twoBuckets([0, 10]);
    const b = twoBuckets([10, 0]);

    expect(blend(a, b, 0).series[0]?.values).toEqual([0, 10]);
    expect(blend(a, b, 1).series[0]?.values).toEqual([10, 0]);
  });

  it("moves each value its own way, eased, so the pair is symmetric about the midpoint but not at it", () => {
    const mid = blend(twoBuckets([0, 10]), twoBuckets([10, 0]), 0.5);

    const [rising, falling] = mid.series[0]?.values ?? [];
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(10);
    expect(falling).toBeGreaterThan(0);
    expect(falling).toBeLessThan(10);
    expect((rising ?? 0) + (falling ?? 0)).toBeCloseTo(10, 3);
  });

  it("puts the new axis on every frame instead of tweening it", () => {
    // Lerping the maximum would move the tick labels through 3.7 and 7.4.
    const a = twoBuckets([1], 5);
    const b = twoBuckets([9], 10);

    for (const t of [0, 0.25, 0.5, 1]) {
      expect(blend(a, b, t).axes[0]?.max).toBe(10);
    }
  });

  it("grows a mark with no counterpart in from the baseline", () => {
    // Unmeasured before and present now, the mark enters from zero rather than at full height.
    const mid = blend(twoBuckets([null, 4], 10), twoBuckets([8, 8], 10), 0.5);

    const [entering, travelling] = mid.series[0]?.values ?? [];
    expect(entering).toBeGreaterThan(0);
    expect(entering).toBeLessThan(8);
    expect(travelling).toBeGreaterThan(4);
    expect(travelling).toBeLessThan(8);
  });

  it("matches values by bucket key, not by position", () => {
    // The window slid on a month, so February is index 1 before and index 0 after.
    const a = result(["2026-01", "2026-02"], [[null, [0, 10]]]);
    const b = result(["2026-02", "2026-03"], [[null, [10, 6]]]);

    const mid = blend(a, b, 0.5).series[0]?.values ?? [];

    // February held 10 and holds 10, so it doesn't move; March is new, so it rises from the floor.
    expect(mid[0]).toBe(10);
    expect(mid[1]).toBeGreaterThan(0);
    expect(mid[1]).toBeLessThan(6);
  });

  it("keeps the surviving buckets of a zoom still", () => {
    const full = result(
      ["2026-01", "2026-02", "2026-03", "2026-04"],
      [[null, [1, 2, 3, 4]]],
      10,
    );
    const zoomed = result(["2026-02", "2026-03"], [[null, [2, 3]]], 4);

    expect(blend(full, zoomed, 0.5).series[0]?.values).toEqual([2, 3]);
  });

  it("matches a series on its slice, so genres do not cross-animate", () => {
    const a = result(
      ["2026-01"],
      [
        ["Fantasy", [4]],
        ["Horror", [0]],
      ],
      10,
    );
    // The two slices swap order on the wire.
    const b = result(
      ["2026-01"],
      [
        ["Horror", [0]],
        ["Fantasy", [4]],
      ],
      10,
    );

    const mid = blend(a, b, 0.5);

    expect(mid.series.map((s) => s.values)).toEqual([[0], [4]]);
  });

  it("carries the target's flags rather than the old ones", () => {
    const target = {
      ...twoBuckets([3, 4], 4),
      stacked: true,
      truncated: true,
      caveats: ["A caveat."],
    };

    const mid = blend(twoBuckets([1, 2], 4), target, 0.5);

    expect(mid).toMatchObject({
      stacked: true,
      truncated: true,
      caveats: ["A caveat."],
    });
  });
});

describe("easeOut", () => {
  it("is pinned at both ends and out-eased between them", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it("never falls on the way", () => {
    const steps = Array.from({ length: 21 }, (_, i) => easeOut(i / 20));

    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("clamps a stray frame outside the run", () => {
    expect(easeOut(1.4)).toBe(1);
    expect(easeOut(-0.2)).toBe(0);
  });
});

describe("useTweened", () => {
  const FRAME_MS = 16;
  const FRAMES = 22;
  const first = twoBuckets([0, 0]);
  const next = twoBuckets([10, 10], 40);

  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tweened = (target: ChartResult | null) =>
    renderHook(({ target }) => useTweened(target), {
      initialProps: { target },
    });

  const advance = (frames: number) =>
    act(() => {
      vi.advanceTimersByTime(frames * FRAME_MS);
    });

  it("shows the first result at once", () => {
    const { result } = tweened(first);

    expect(result.current).toBe(first);
  });

  it("is nothing while there is no result", () => {
    const { result } = tweened(null);

    expect(result.current).toBeNull();
  });

  it("travels to a new result over 22 frames, on the new axis from the first", () => {
    const { result, rerender } = tweened(first);

    rerender({ target: next });
    // Until the first frame renders, the old chart stays.
    expect(result.current?.series[0]?.values).toEqual([0, 0]);

    advance(1);
    expect(result.current?.axes[0]?.max).toBe(40);
    const [early] = result.current?.series[0]?.values ?? [];
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(10);

    advance(FRAMES - 1);
    expect(result.current?.series[0]?.values).toEqual([10, 10]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a new result at once when the reader asks for less motion", () => {
    stubReducedMotion(true);
    const { result, rerender } = tweened(first);

    rerender({ target: next });

    expect(result.current).toBe(next);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders a result over 120 buckets at once", () => {
    const wide = result(
      Array.from({ length: 121 }, (_, i) => `b${i}`),
      [[null, Array.from({ length: 121 }, () => 5)]],
    );
    const { result: shown, rerender } = tweened(first);

    rerender({ target: wide });

    expect(shown.current).toBe(wide);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still tweens a result of exactly 120 buckets", () => {
    const edge = result(
      Array.from({ length: 120 }, (_, i) => `b${i}`),
      [[null, Array.from({ length: 120 }, () => 5)]],
    );
    const { rerender } = tweened(first);

    rerender({ target: edge });

    expect(vi.getTimerCount()).toBe(1);
  });

  it("lets a newer result take over a running tween from where it had got to", () => {
    const [a, b, c] = [twoBuckets([0, 0]), next, twoBuckets([20, 20], 40)];
    const { result: shown, rerender } = tweened(a);
    rerender({ target: b });
    advance(11);
    rerender({ target: c });

    advance(11);
    // Had the first run kept going, it would move the bars back under 10.
    expect(shown.current?.series[0]?.values[0]).toBeGreaterThan(15);

    advance(FRAMES - 11);
    expect(shown.current?.series[0]?.values).toEqual([20, 20]);
  });
});

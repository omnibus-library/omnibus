import { describe, expect, it } from "vitest";
import { coverShape, leanAngles } from "./lean";

const COVER = { left: 0, top: 0, width: 100, height: 150 };

describe("leanAngles", () => {
  it("returns zero at the cover centre", () => {
    expect(leanAngles({ x: 50, y: 75 }, COVER)).toEqual({ rx: 0, ry: 0 });
  });

  it("turns toward a pointer on the right", () => {
    // 80 px right of centre is half of the 160 px (1.6 widths) that reaches the full turn.
    expect(leanAngles({ x: 130, y: 75 }, COVER)).toEqual({ rx: 0, ry: 4 });
  });

  it("tips the top away from a pointer below", () => {
    // 90 px below centre is half of the 180 px (1.2 heights) that reaches the full tip.
    expect(leanAngles({ x: 50, y: 165 }, COVER)).toEqual({ rx: -3, ry: 0 });
  });

  it("clamps to eight degrees across and six down", () => {
    expect(leanAngles({ x: 10_000, y: -10_000 }, COVER)).toEqual({
      rx: 6,
      ry: 8,
    });
    expect(leanAngles({ x: -10_000, y: 10_000 }, COVER)).toEqual({
      rx: -6,
      ry: -8,
    });
  });
});

describe("coverShape", () => {
  it("calls a cover within four percent of square square", () => {
    expect(coverShape(100, 100)).toBe("square");
    expect(coverShape(100, 96)).toBe("square");
    expect(coverShape(104, 100)).toBe("square");
  });

  it("calls anything further from square portrait", () => {
    expect(coverShape(100, 95)).toBe("portrait");
    expect(coverShape(898, 1200)).toBe("portrait");
  });

  it("calls a cover that has not been measured portrait", () => {
    expect(coverShape(0, 0)).toBe("portrait");
  });
});

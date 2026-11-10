import { expect } from "storybook/test";

/** The element a query found, or a throw naming what was missing, so a renamed selector fails by name rather than as a number mismatch. */
export function found<T extends Element>(
  el: T | null | undefined,
  what: string,
): T {
  if (!el) throw new Error(`${what} is missing`);
  return el;
}

/** Asserts a cover box is a 2:3 plate, to the pixel either way after rounding both sides. */
export async function expectPlate(width: number, height: number) {
  await expect(
    Math.abs(Math.round(height) - Math.round(width * 1.5)),
  ).toBeLessThanOrEqual(1);
}

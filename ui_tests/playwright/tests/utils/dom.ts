import type { Locator, Page } from "@playwright/test";

/** Sets a range input and fires `input`; `commit` adds the `change` a release sends. */
export async function setRange(
  slider: Locator,
  value: number,
  { commit = false } = {},
): Promise<void> {
  await slider.evaluate(
    (el, args) => {
      const input = el as HTMLInputElement;
      input.value = String(args.value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (args.commit) {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { value, commit },
  );
}

/** Lets `frames` animation frames run: a wait that resolves on the frame, not a sleep. */
export async function nextFrame(page: Page, frames = 1): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, frames);
}

/** `locator`'s top edge in CSS pixels, so a test can compare vertical order. */
export async function topEdge(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.y ?? Number.NaN;
}

/** `locator`'s bottom edge in CSS pixels. */
export async function bottomEdge(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return box ? box.y + box.height : Number.NaN;
}

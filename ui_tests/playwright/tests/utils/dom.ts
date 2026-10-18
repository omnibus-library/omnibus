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

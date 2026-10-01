import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/test";
import {
  buildChapterEpub,
  type GlueWindow,
  openGlue,
  relocates,
} from "../utils/ios_glue";

// Reopening a book re-states a position the server already holds, so every
// relocate the restore produces must be an echo: a write would stamp a fresh
// clock on an unmoved position and shadow a newer audiobook one at the
// cross-format clock gate.

const PROSE = Array.from(
  { length: 60 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");
// The start of paragraph 30, several pages in.
const RESTORE_CFI = "epubcfi(/6/2!/4/60/1:0)";

/**
 * Nothing the restore reported was movement. An absence, so a window: long
 * enough for any relocate still in flight to clear the 400ms debounce.
 */
async function expectOnlyEchoes(page: Page): Promise<void> {
  await expect
    .poll(async () => (await relocates(page)).length)
    .toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const moved = (await relocates(page)).filter((r) => !r.echo);
  expect(moved, "a reopen must report no movement").toEqual([]);
}

/** A genuine page turn after the restore still reports movement. */
async function expectTurnWrites(page: Page): Promise<void> {
  const before = (await relocates(page)).filter((r) => !r.echo).length;
  await page.evaluate(() =>
    (window as unknown as GlueWindow).OmnibusReader.next(),
  );
  await expect
    .poll(async () => (await relocates(page)).filter((r) => !r.echo).length)
    .toBe(before + 1);
}

test.describe("iOS reader restore", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test("a quick reopen reports only echoes, and a turn still writes", async ({
    page,
  }) => {
    await openGlue(page, await buildChapterEpub(PROSE), { cfi: RESTORE_CFI });

    await expectOnlyEchoes(page);
    await expectTurnWrites(page);
  });

  test("a reopen whose settle outlasts the relocate debounce reports only echoes, and a turn still writes", async ({
    page,
  }) => {
    // A face still loading when the settle chain asks, held past the
    // debounce — what a slow named face does on a device.
    await page.addInitScript(() => {
      if (window === window.top) return;
      Object.defineProperty(FontFaceSet.prototype, "ready", {
        get: () => new Promise((resolve) => setTimeout(resolve, 700)),
      });
    });
    await openGlue(page, await buildChapterEpub(PROSE), { cfi: RESTORE_CFI });

    await expectOnlyEchoes(page);
    await expectTurnWrites(page);
  });
});

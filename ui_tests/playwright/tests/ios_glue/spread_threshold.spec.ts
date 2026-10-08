import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/test";
import {
  buildChapterEpub,
  type GlueWindow,
  openGlue,
  type Settled,
} from "../utils/ios_glue";

// The width the host hands `init` is the one columns pair at. 900 rather than
// the real 800, because 800 is epub.js's own default and couldn't show that the
// option was forwarded at all.
const THRESHOLD = 900;
const PROSE = Array.from(
  { length: 30 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");

async function columns(page: Page): Promise<number> {
  const settled: Settled = await page.evaluate(() =>
    (window as unknown as GlueWindow).OmnibusReader.whenSettled(),
  );
  return settled.columns;
}

test.describe("iOS reader glue: the two-page threshold", () => {
  // `#stage` is the viewport less 10px a side, so 920 wide is a 900 stage.
  test.describe("a stage exactly at the threshold", () => {
    test.use({ viewport: { width: 920, height: 700 } });

    test("pairs its columns", async ({ page }) => {
      await openGlue(page, await buildChapterEpub(PROSE), {
        spread: "auto",
        minSpreadWidth: THRESHOLD,
      });

      expect(await columns(page)).toBe(2);
    });
  });

  test.describe("a stage a pixel under the threshold", () => {
    test.use({ viewport: { width: 919, height: 700 } });

    test("stays on one column where epub.js's own default would pair", async ({
      page,
    }) => {
      await openGlue(page, await buildChapterEpub(PROSE), {
        spread: "auto",
        minSpreadWidth: THRESHOLD,
      });

      expect(await columns(page)).toBe(1);
    });

    test("keeps the threshold across a spread toggle", async ({ page }) => {
      await openGlue(page, await buildChapterEpub(PROSE), {
        spread: "none",
        minSpreadWidth: THRESHOLD,
      });

      await page.evaluate(() =>
        (window as unknown as GlueWindow).OmnibusReader.setSpread("auto"),
      );
      expect(
        await columns(page),
        "turning pairing on is not the threshold",
      ).toBe(1);

      await page.setViewportSize({ width: 920, height: 700 });
      await expect.poll(() => columns(page)).toBe(2);
    });
  });
});

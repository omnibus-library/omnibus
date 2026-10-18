import { buildChapterEpub } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

// The width the host hands `init` is the one columns pair at. 900 rather than
// the real 800, because 800 is epub.js's own default and couldn't show that the
// option was forwarded at all.
const THRESHOLD = 900;
const PROSE = Array.from(
  { length: 30 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");

test.describe("ios reader glue: the two-page threshold", () => {
  // `#stage` is the viewport less 10px a side, so 920 wide is a 900 stage.
  test.describe("a stage exactly at the threshold", () => {
    test.use({ viewport: { width: 920, height: 700 } });

    test("pair its columns", async ({ iosGluePage }) => {
      await test.step("open the book with spreads on", async () => {
        await iosGluePage.openBook(await buildChapterEpub(PROSE), {
          spread: "auto",
          minSpreadWidth: THRESHOLD,
        });
      });

      await test.step("check the columns pair", async () => {
        expect(await iosGluePage.columns()).toBe(2);
      });
    });
  });

  test.describe("a stage a pixel under the threshold", () => {
    test.use({ viewport: { width: 919, height: 700 } });

    test("stay on one column where epub.js's own default would pair", async ({
      iosGluePage,
    }) => {
      await test.step("open the book with spreads on", async () => {
        await iosGluePage.openBook(await buildChapterEpub(PROSE), {
          spread: "auto",
          minSpreadWidth: THRESHOLD,
        });
      });

      await test.step("check the stage holds one column", async () => {
        expect(await iosGluePage.columns()).toBe(1);
      });
    });

    test("keep the threshold across a spread toggle", async ({
      iosGluePage,
    }) => {
      await test.step("open the book with spreads off", async () => {
        await iosGluePage.openBook(await buildChapterEpub(PROSE), {
          spread: "none",
          minSpreadWidth: THRESHOLD,
        });
      });

      await test.step("turn spreads on", async () => {
        await iosGluePage.setSpread("auto");
      });

      await test.step("check the stage still holds one column", async () => {
        expect(
          await iosGluePage.columns(),
          "turning pairing on is not the threshold",
        ).toBe(1);
      });

      await test.step("widen the window to the threshold", async () => {
        await iosGluePage.resizeViewport({ width: 920, height: 700 });
      });

      await test.step("check the columns pair", async () => {
        await expect.poll(() => iosGluePage.columns()).toBe(2);
      });
    });
  });
});

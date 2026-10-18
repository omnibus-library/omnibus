import { buildChapterEpub } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

const PROSE = Array.from(
  { length: 60 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");
// The start of paragraph 30, several pages in.
const RESTORE_CFI = "epubcfi(/6/2!/4/60/1:0)";

// A reopen re-states a position the server already holds, so a relocate that
// reports movement would stamp a fresh clock and shadow a newer audiobook one.
test.describe("ios reader restore", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test.describe("a quick reopen", () => {
    test.beforeEach(
      "reopen the book and let the restore settle",
      async ({ iosGluePage }) => {
        await iosGluePage.openBook(await buildChapterEpub(PROSE), {
          cfi: RESTORE_CFI,
        });
        await iosGluePage.waitForFirstRelocate();
        await iosGluePage.waitOutRelocateDebounce();
      },
    );

    test("report only echoes", async ({ iosGluePage }) => {
      await test.step("check no relocate reports movement", async () => {
        expect(
          await iosGluePage.movements(),
          "a reopen must report no movement",
        ).toEqual([]);
      });
    });

    test("report movement for a page turn", async ({ iosGluePage }) => {
      const before = (await iosGluePage.movements()).length;

      await test.step("turn the page", async () => {
        await iosGluePage.next();
      });

      await test.step("check the turn reports one movement", async () => {
        await expect
          .poll(async () => (await iosGluePage.movements()).length)
          .toBe(before + 1);
      });
    });
  });

  test.describe("a reopen whose settle outlasts the relocate debounce", () => {
    test.beforeEach(
      "reopen the book behind a slow font face and let the restore settle",
      async ({ iosGluePage }) => {
        // A face still loading when the settle chain asks, held past the
        // debounce, is what a slow named face does on a device.
        await iosGluePage.holdFontsReady(700);
        await iosGluePage.openBook(await buildChapterEpub(PROSE), {
          cfi: RESTORE_CFI,
        });
        await iosGluePage.waitForFirstRelocate();
        await iosGluePage.waitOutRelocateDebounce();
      },
    );

    test("report only echoes", async ({ iosGluePage }) => {
      await test.step("check no relocate reports movement", async () => {
        expect(
          await iosGluePage.movements(),
          "a reopen must report no movement",
        ).toEqual([]);
      });
    });

    test("report movement for a page turn", async ({ iosGluePage }) => {
      const before = (await iosGluePage.movements()).length;

      await test.step("turn the page", async () => {
        await iosGluePage.next();
      });

      await test.step("check the turn reports one movement", async () => {
        await expect
          .poll(async () => (await iosGluePage.movements()).length)
          .toBe(before + 1);
      });
    });
  });
});

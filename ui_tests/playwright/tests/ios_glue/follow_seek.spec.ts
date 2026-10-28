import { buildChapterEpub, type RelocatePayload } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

const PROSE = Array.from(
  { length: 60 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");
// The start of paragraph 3, on the first page.
const EARLY_CFI = "epubcfi(/6/2!/4/6/1:0)";
// The start of paragraph 10, a couple of pages in.
const RESTORE_CFI = "epubcfi(/6/2!/4/20/1:0)";

/** Where the 0.8 jump landed in what the glue reported, or -1. */
function jumpIndex(relocates: RelocatePayload[]): number {
  return relocates.findIndex(
    (relocate) => !relocate.echo && relocate.pct >= 70,
  );
}

// The follow jump's answer reaches the reader before the book has loaded, so a
// seek that can't resolve yet must wait for the locations pass, not vanish.
test.describe("ios reader seek before the locations pass", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test("land the seek once the locations exist", async ({ iosGluePage }) => {
    await test.step("open the book with a seek sent alongside init", async () => {
      await iosGluePage.openBook(
        await buildChapterEpub(PROSE),
        {},
        {
          seek: 0.8,
        },
      );
    });

    await test.step("check the reader moved to the sought spot", async () => {
      await expect
        .poll(async () =>
          (await iosGluePage.movements()).some(
            (relocate) => relocate.pct >= 70,
          ),
        )
        .toBe(true);
    });
  });

  // The host never saves its first relocate, so a jump folded into the
  // restore's landing report was only written on close, on the close's clock.
  test("report the restore's landing before a jump sent on ready", async ({
    iosGluePage,
  }) => {
    await test.step("reopen the book and seek as it reports ready", async () => {
      await iosGluePage.openBook(
        await buildChapterEpub(PROSE),
        { cfi: RESTORE_CFI },
        { seekOnReady: 0.8 },
      );
    });

    await test.step("check the jump lands as movement", async () => {
      await expect
        .poll(async () => jumpIndex(await iosGluePage.relocates()))
        .toBeGreaterThan(-1);
    });

    await test.step("check the landing was reported first, as an echo", async () => {
      const relocates = await iosGluePage.relocates();
      const jump = jumpIndex(relocates);
      expect(jump, "the jump is not the first relocate").toBeGreaterThan(0);
      expect(
        relocates[0]?.echo,
        "the first relocate is the restore's echo",
      ).toBe(true);
      expect(relocates[0]?.settledSeek, "the landing predates the seek").toBe(
        null,
      );
      expect(relocates[jump]?.settledSeek, "the jump settles the seek").toBe(1);
    });
  });

  // epub.js reports a landing a frame after its display resolves, and with the
  // locations cached the jump can arrive inside that frame.
  test("report the landing before a jump on cached locations", async ({
    iosGluePage,
  }) => {
    const epub = await buildChapterEpub(PROSE);

    await test.step("open the book once, so its locations are cached", async () => {
      await iosGluePage.openBook(epub, { locationsKey: "follow-seek" });
      await iosGluePage.waitForLocationsPass();
    });

    await test.step("reopen it with nothing to restore and seek as it reports ready", async () => {
      await iosGluePage.openBook(
        epub,
        { locationsKey: "follow-seek" },
        { seekOnReady: 0.8 },
      );
    });

    await test.step("check the landing was reported before the jump", async () => {
      await expect
        .poll(async () => jumpIndex(await iosGluePage.relocates()))
        .toBeGreaterThan(0);
      const [landing] = await iosGluePage.relocates();
      expect(
        landing?.pct ?? 100,
        "the landing is the book's start",
      ).toBeLessThan(50);
    });
  });

  // A stored position written under another device's pagination restores a
  // page off, and the follow fraction can resolve to the page now on screen.
  test("leave the restored page standing when the seek resolves to it", async ({
    iosGluePage,
  }) => {
    await test.step("reopen the book on its first page and seek to its start", async () => {
      await iosGluePage.openBook(
        await buildChapterEpub(PROSE),
        { cfi: EARLY_CFI },
        { seekOnReady: 0 },
      );
      await iosGluePage.waitForLocationsPass();
      await iosGluePage.waitOutRelocateDebounce();
    });

    await test.step("check no relocate reports movement", async () => {
      expect(
        await iosGluePage.movements(),
        "a jump to the page on screen is no move",
      ).toEqual([]);
    });
  });

  test("drop the seek when the reader navigates first", async ({
    iosGluePage,
  }) => {
    await test.step("open the book with a seek, then a jump, alongside init", async () => {
      await iosGluePage.openBook(
        await buildChapterEpub(PROSE),
        {},
        {
          seek: 0.8,
          display: EARLY_CFI,
        },
      );
      await iosGluePage.waitForLocationsPass();
      await iosGluePage.waitOutRelocateDebounce();
    });

    await test.step("check the reader stayed where the jump put it", async () => {
      expect(
        (await iosGluePage.relocates()).filter(
          (relocate) => relocate.pct >= 50,
        ),
        "a parked seek must not land after the reader moved",
      ).toEqual([]);
    });
  });
});

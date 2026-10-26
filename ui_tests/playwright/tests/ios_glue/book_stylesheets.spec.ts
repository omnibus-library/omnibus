import { BOOK_FONT, bookWithSheetFont } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

const FAMILY = "Harbour Serif";

// The glue inlines each book sheet into the section, where its url()s would
// resolve against the chapter's folder. On iOS every request the reader can't
// serve is a scheme-handler failure, and one before the book is ready puts up
// the "couldn't open" screen.
test.describe("ios reader book stylesheets", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test("load a book's font from a sheet in another folder", async ({
    iosGluePage,
  }) => {
    await test.step("open a book whose sheet embeds its font", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({ family: FAMILY, font: BOOK_FONT }),
      );
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toContain("loaded");
    });

    // A failed copy falls through to the next, so a loaded face proves nothing
    // about the others: check each declaration points into the book.
    await test.step("check every copy of the face is declared from the book", async () => {
      const { srcs, statuses } = await iosGluePage.fontFaces(FAMILY);
      expect(srcs.length).toBeGreaterThan(0);
      for (const src of srcs) expect(src).toMatch(/^url\("data:font\/woff2;/);
      expect(statuses).not.toContain("error");
    });
  });

  // Encrypted fonts read as noise to epub.js, which is how a real book hit
  // this: every copy fails, the engine falls through to the inlined one, and
  // that one's request is the one the reader can't serve.
  test("make no request outside the book for a font that does not decode", async ({
    iosGluePage,
  }) => {
    await test.step("open a book whose embedded font is noise", async () => {
      const noise = Buffer.from("an encrypted face, as epub.js reads one");
      await iosGluePage.openBook(
        await bookWithSheetFont({ family: FAMILY, font: noise }),
      );
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toEqual(["error", "error"]);
    });

    await test.step("check nothing was requested outside the book", async () => {
      expect(iosGluePage.unservedRequests()).toEqual([]);
    });
  });

  // epub.js drops a file it could not read from its replacement table, which
  // then no longer lines up with the book's assets.
  test("make no request outside the book when a listed file is missing", async ({
    iosGluePage,
  }) => {
    await test.step("open a book missing a file listed ahead of its font", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({
          family: FAMILY,
          font: BOOK_FONT,
          missingAsset: true,
        }),
      );
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toContain("loaded");
    });

    // epub.js's own copy, in the blob: sheet it links, keeps a relative url()
    // that cannot resolve against a blob: and so asks for nothing.
    await test.step("check the inlined face is declared from the book", async () => {
      const { srcs } = await iosGluePage.fontFaces(FAMILY);
      expect(srcs.some((src) => /^url\("blob:/.test(src))).toBe(true);
    });

    await test.step("check nothing was requested outside the book", async () => {
      expect(iosGluePage.unservedRequests()).toEqual([]);
    });
  });
});

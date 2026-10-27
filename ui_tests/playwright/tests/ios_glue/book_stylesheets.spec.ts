import { BOOK_FONT, bookWithSheetFont, PICTURE_WIDTH } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

const FAMILY = "Harbour Serif";

// The glue inlines each book sheet into the section, where its url()s would
// resolve against the chapter's folder; epub.js points the book's links at its
// own copies of the book's files. On iOS every request the reader can't serve
// is a scheme-handler failure, and one before the book is ready puts up the
// "couldn't open" screen.
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

  // epub.js reads a sheet the zip lacks as nothing at all, which must not
  // keep the sheets listed after it out of the section.
  test("inline a book's sheet listed after one it lacks", async ({
    iosGluePage,
  }) => {
    await test.step("open a book listing a sheet it lacks ahead of its own", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({
          family: FAMILY,
          font: BOOK_FONT,
          missingSheet: true,
        }),
      );
    });

    await test.step("check the sheet the book has is inlined", async () => {
      await expect.poll(() => iosGluePage.inlinedSheetCount()).toBe(1);
    });
  });

  // epub.js leaves a file the zip lacks out of its table of copies, which
  // shifts every file listed after it onto the next one's copy.
  test("show each file from its own copy when the book lists one it lacks", async ({
    iosGluePage,
  }) => {
    await test.step("open a book listing a picture it lacks ahead of the rest", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({
          family: FAMILY,
          font: BOOK_FONT,
          missingFile: true,
        }),
      );
    });

    await test.step("check the picture listed after it is its own file", async () => {
      await expect
        .poll(() => iosGluePage.imageWidth("#picture"))
        .toBe(PICTURE_WIDTH);
    });

    await test.step("check the sheet's face loads", async () => {
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toContain("loaded");
    });

    // The host's check is what reports a broken book, so the file the book
    // lacks must still be asked of it rather than pointed at another.
    await test.step("check the missing picture is asked of the host", async () => {
      await expect
        .poll(() => iosGluePage.unservedRequests())
        .toEqual(["OEBPS/images/absent.png"]);
      expect(await iosGluePage.imageWidth("#absent")).toBe(0);
    });
  });
});

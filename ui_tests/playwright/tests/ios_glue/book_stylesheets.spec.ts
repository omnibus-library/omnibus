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
    await test.step("open a book missing a file and a sheet listed ahead of its own", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({
          family: FAMILY,
          font: BOOK_FONT,
          missingAsset: true,
          missingSheet: true,
        }),
      );
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toContain("loaded");
    });

    await test.step("check the sheet the book has is still inlined", async () => {
      await expect.poll(() => iosGluePage.inlinedBookCss()).toHaveLength(1);
    });

    // epub.js's own copy, in the blob: sheet it links, keeps a relative url()
    // that cannot resolve against a blob: and so asks for nothing.
    await test.step("check the inlined face is declared from the book", async () => {
      const [css] = await iosGluePage.inlinedBookCss();
      expect(css).toContain('src: url("data:,") format("woff2"), url("blob:');
      expect(css).not.toContain("../");
    });

    await test.step("check nothing was requested outside the book", async () => {
      expect(iosGluePage.unservedRequests()).toEqual([]);
    });
  });

  // epub.js writes each sheet it rewrites back at the sheet's own index, so a
  // sheet listed last refills the short table to full length, out of step.
  test("point each url at its own file when a missing one is listed ahead", async ({
    iosGluePage,
  }) => {
    await test.step("open a book missing a file listed ahead of an image", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({
          family: FAMILY,
          font: BOOK_FONT,
          missingAsset: true,
          refilledTable: true,
        }),
      );
      await expect.poll(() => iosGluePage.inlinedBookCss()).toHaveLength(1);
    });

    await test.step("check the missing face is pointed at nothing", async () => {
      const [css] = await iosGluePage.inlinedBookCss();
      expect(css).toContain(
        'src: url("data:,") format("woff2"), url("data:font/woff2;',
      );
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toContain("loaded");
    });

    await test.step("check the image is pointed at the image", async () => {
      const [css = ""] = await iosGluePage.inlinedBookCss();
      const image = /body \{ background-image: url\("(blob:[^"]+)"\)/.exec(css);
      expect(image).not.toBeNull();
      expect(await iosGluePage.blobType(image?.[1] ?? "")).toBe("image/png");
    });

    await test.step("check nothing was requested outside the book", async () => {
      expect(iosGluePage.unservedRequests()).toEqual([]);
    });
  });

  // epub.js replaces each file's relative path wherever it appears, so a
  // missing Face.woff rewrites the inside of Face.woff2's url() too.
  test("point each url at its own file when one file's path is inside another's", async ({
    iosGluePage,
  }) => {
    await test.step("open a book missing a face whose path the real face's contains", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({
          family: FAMILY,
          font: BOOK_FONT,
          missingAsset: true,
          missingFace: "BookFace.woff",
          refilledTable: true,
        }),
      );
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toContain("loaded");
    });

    await test.step("check the real face is pointed at its own file", async () => {
      const [css] = await iosGluePage.inlinedBookCss();
      expect(css).toContain(
        'src: url("data:,") format("woff2"), url("data:font/woff2;',
      );
    });

    await test.step("check nothing was requested outside the book", async () => {
      expect(iosGluePage.unservedRequests()).toEqual([]);
    });
  });

  // A sheet's string @import, a name the manifest percent-encodes and a CSS
  // string that reads like a url() each slip past a scan for url( alone.
  test("load a face from an imported sheet that spells its name decoded", async ({
    iosGluePage,
  }) => {
    await test.step("open a book whose sheet imports the face's sheet", async () => {
      await iosGluePage.openBook(
        await bookWithSheetFont({
          family: FAMILY,
          font: BOOK_FONT,
          faceFile: "Book Face.woff2",
          importedFace: true,
          quotedUrl: true,
        }),
      );
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toContain("loaded");
    });

    await test.step("check the face is declared from the book", async () => {
      const { srcs } = await iosGluePage.fontFaces(FAMILY);
      expect(srcs).toContainEqual(
        expect.stringMatching(/^url\("data:font\/woff2;/),
      );
    });

    await test.step("check the content string is left as written", async () => {
      const css = (await iosGluePage.inlinedBookCss()).join("\n");
      expect(css).toContain('content: "url(x)";');
    });

    await test.step("check nothing was requested outside the book", async () => {
      expect(iosGluePage.unservedRequests()).toEqual([]);
    });
  });
});

import { BOOK_FONT, buildChapterEpub } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

const FAMILY = "Harbour Serif";

// The shape Calibre gives a book: the sheet in one folder and the chapters in
// another, the sheet embedding its font by a url() relative to itself.
const SHEET = `
@font-face { font-family: "${FAMILY}"; src: url("../fonts/HarbourSerif.woff2") format("woff2"); }
p { font-family: "${FAMILY}", serif; }
`;
const PROSE = Array.from(
  { length: 12 },
  (_, i) => `<p>Paragraph ${i + 1} of the harbour, set in the book's face.</p>`,
).join("");

function bookWithSheetFont(font: Buffer): Promise<Buffer> {
  return buildChapterEpub(PROSE, {
    head: '<link href="styles/book.css" rel="stylesheet" type="text/css"/>',
    files: {
      "styles/book.css": { data: SHEET, mediaType: "text/css" },
      "fonts/HarbourSerif.woff2": { data: font, mediaType: "font/woff2" },
    },
  });
}

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
      await iosGluePage.openBook(await bookWithSheetFont(BOOK_FONT));
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
      await iosGluePage.openBook(await bookWithSheetFont(noise));
      await expect
        .poll(async () => (await iosGluePage.fontFaces(FAMILY)).statuses)
        .toEqual(["error", "error"]);
    });

    await test.step("check nothing was requested outside the book", async () => {
      expect(iosGluePage.unservedRequests()).toEqual([]);
    });
  });
});

import { expect, test } from "../fixtures/test";
import { buildChapterEpub, openGlue, relocates } from "../utils/ios_glue";

// The chapter a relocate names when several table-of-contents anchors share
// one spine item: the one the page is in, not the item's last.

const PROSE = Array.from(
  { length: 40 },
  (_, i) =>
    `Sentence ${i + 1} of a long stretch of prose that runs on across the page.`,
).join(" ");
const CHAPTER = `
<h2 id="one">One</h2><p>${PROSE}</p>
<h2 id="two">Two</h2><p>${PROSE}</p>
<h2 id="three">Three</h2><p>${PROSE}</p>
`;
const TOC: [string, string][] = [
  ["One", "chapter.xhtml#one"],
  ["Two", "chapter.xhtml#two"],
  ["Three", "chapter.xhtml#three"],
];

test.describe("iOS reader chapter label", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  for (const [title, para] of [
    ["One", 4],
    ["Two", 8],
  ] as const) {
    test(`a page inside chapter ${title} of a shared spine item is named ${title}`, async ({
      page,
    }) => {
      const epub = await buildChapterEpub(CHAPTER, { toc: TOC });
      // Well into the chapter's paragraph, so the page starts inside it.
      await openGlue(page, epub, { cfi: `epubcfi(/6/2!/4/${para}/1:1500)` });

      await expect
        .poll(async () => (await relocates(page)).at(-1)?.chapterTitle)
        .toBe(title);
    });
  }
});

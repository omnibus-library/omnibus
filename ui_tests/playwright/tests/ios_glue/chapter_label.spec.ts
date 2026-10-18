import { buildChapterEpub } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

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

test.describe("ios reader chapter label", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  // The chapter is the one the page is in, not the spine item's last.
  test.describe("a spine item shared by several chapters", () => {
    for (const [title, paragraph] of [
      ["One", 4],
      ["Two", 8],
    ] as const) {
      test(`name chapter ${title} for a page inside it`, async ({
        iosGluePage,
      }) => {
        await test.step(`open the book inside chapter ${title}`, async () => {
          const epub = await buildChapterEpub(CHAPTER, { toc: TOC });
          // Well into the chapter's paragraph, so the page starts inside it.
          await iosGluePage.openBook(epub, {
            cfi: `epubcfi(/6/2!/4/${paragraph}/1:1500)`,
          });
        });

        await test.step("check the relocate names that chapter", async () => {
          await expect
            .poll(
              async () => (await iosGluePage.relocates()).at(-1)?.chapterTitle,
            )
            .toBe(title);
        });
      });
    }
  });
});

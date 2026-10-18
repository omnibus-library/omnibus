import { bottomOf, buildChapterEpub } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

const PLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200"><rect width="240" height="200" fill="#8a7"/></svg>`;
const CHAPTER = `
<p id="above">The lamps along the quay were lit.</p>
<img id="plate" src="plate.svg" alt="" style="display: block; width: 240px; height: 200px; margin: 1em auto;"/>
<p id="below">Nobody said a word about it.</p>
<p id="long">It was the sort of evening that made the harbour look like a postcard, and the tide came in the way bad news does, quietly, over the stones and the weed and the ropes, until the boats rode high against the wall and the gulls went inland for the night.</p>
`;

// The bars the host paints for a selection: one row per line, grown to close
// the leading between lines and only the leading.
test.describe("ios reader selection rows", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test.beforeEach(
    "open a chapter with a block image",
    async ({ iosGluePage }) => {
      const epub = await buildChapterEpub(CHAPTER, {
        files: { "plate.svg": { data: PLATE_SVG, mediaType: "image/svg+xml" } },
      });
      await iosGluePage.openBook(epub, { lineHeight: 1.6 });
    },
  );

  test("paint a line-high bar on each line either side of a block image and nothing over it", async ({
    iosGluePage,
  }) => {
    await test.step("drag from the line above the image to the line below", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("above", "lamps"),
        await iosGluePage.wordPoint("below", "said"),
      );
    });

    await test.step("check one bar paints on each line and none over the image", async () => {
      const { rects } = await iosGluePage.settledSelection();
      const plate = await iosGluePage.hostBox("plate");
      const { lineHeight } = await iosGluePage.hostBox("above");
      expect(lineHeight).toBeGreaterThan(0);
      expect(rects).toHaveLength(2);
      for (const r of rects) {
        expect(r.height).toBeLessThanOrEqual(lineHeight + 1);
      }
      expect(bottomOf(rects[0]!)).toBeLessThanOrEqual(plate.top + 1);
      expect(rects[1]!.y).toBeGreaterThanOrEqual(plate.bottom - 1);
    });
  });

  test("paint one continuous block no taller than its lines down a paragraph", async ({
    iosGluePage,
  }) => {
    await test.step("drag down the paragraph", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("long", "sort"),
        await iosGluePage.wordPoint("long", "inland"),
      );
    });

    await test.step("check the bars close up and stay inside the paragraph", async () => {
      const { rects } = await iosGluePage.settledSelection();
      const para = await iosGluePage.hostBox("long");
      expect(rects.length).toBeGreaterThan(2);
      for (let i = 1; i < rects.length; i++) {
        expect(Math.abs(rects[i]!.y - bottomOf(rects[i - 1]!))).toBeLessThan(1);
      }
      for (const r of rects) {
        expect(r.height).toBeLessThanOrEqual(para.lineHeight + 1);
      }
      // Neither end runs past the paragraph's own first and last line boxes.
      expect(rects[0]!.y).toBeGreaterThanOrEqual(para.top - 1);
      expect(bottomOf(rects.at(-1)!)).toBeLessThanOrEqual(para.bottom + 1);
    });
  });
});

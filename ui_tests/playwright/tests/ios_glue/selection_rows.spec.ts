import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/test";
import {
  buildChapterEpub,
  dragSelect,
  openGlue,
  type SelectionRect,
  settled,
  wordPoint,
} from "../utils/ios_glue";

// The bars the iOS host paints for a selection: one row per line, grown to
// close the leading between lines — and only the leading.

const PLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200"><rect width="240" height="200" fill="#8a7"/></svg>`;
const CHAPTER = `
<p id="above">The lamps along the quay were lit.</p>
<img id="plate" src="plate.svg" alt="" style="display: block; width: 240px; height: 200px; margin: 1em auto;"/>
<p id="below">Nobody said a word about it.</p>
<p id="long">It was the sort of evening that made the harbour look like a postcard, and the tide came in the way bad news does, quietly, over the stones and the weed and the ropes, until the boats rode high against the wall and the gulls went inland for the night.</p>
`;

/** An element's box in host-window coordinates, as the rows are. */
function hostBox(
  page: Page,
  id: string,
): Promise<{ top: number; bottom: number; lineHeight: number }> {
  return page.evaluate((id) => {
    const frame = document.querySelector<HTMLIFrameElement>("#stage iframe");
    const el = frame?.contentDocument?.getElementById(id);
    const view = frame?.contentWindow;
    if (!frame || !el || !view) throw new Error(`no #${id}`);
    const box = el.getBoundingClientRect();
    const off = frame.getBoundingClientRect();
    return {
      top: off.top + box.top,
      bottom: off.top + box.bottom,
      lineHeight: Number.parseFloat(view.getComputedStyle(el).lineHeight),
    };
  }, id);
}

const bottomOf = (r: SelectionRect) => r.y + r.height;

test.describe("iOS reader selection rows", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test.beforeEach(async ({ page }) => {
    const epub = await buildChapterEpub(CHAPTER, {
      files: { "plate.svg": { data: PLATE_SVG, mediaType: "image/svg+xml" } },
    });
    await openGlue(page, epub, { lineHeight: 1.6 });
  });

  test("a selection either side of a block image paints a line-high bar on each line and nothing over the image", async ({
    page,
  }) => {
    await dragSelect(
      page,
      await wordPoint(page, "above", "lamps"),
      await wordPoint(page, "below", "said"),
    );

    const { rects } = await settled(page);
    const plate = await hostBox(page, "plate");
    const { lineHeight } = await hostBox(page, "above");
    expect(lineHeight).toBeGreaterThan(0);
    expect(rects).toHaveLength(2);
    for (const r of rects) expect(r.height).toBeLessThanOrEqual(lineHeight + 1);
    expect(bottomOf(rects[0]!)).toBeLessThanOrEqual(plate.top + 1);
    expect(rects[1]!.y).toBeGreaterThanOrEqual(plate.bottom - 1);
  });

  test("a selection down a paragraph paints one continuous block no taller than its lines", async ({
    page,
  }) => {
    await dragSelect(
      page,
      await wordPoint(page, "long", "sort"),
      await wordPoint(page, "long", "inland"),
    );

    const { rects } = await settled(page);
    const para = await hostBox(page, "long");
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

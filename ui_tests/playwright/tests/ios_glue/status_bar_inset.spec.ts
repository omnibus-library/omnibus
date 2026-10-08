import type { CDPSession, Page } from "@playwright/test";

import { expect, test } from "../fixtures/test";
import {
  buildChapterEpub,
  type GlueWindow,
  openGlue,
  relocates,
} from "../utils/ios_glue";

// An iPad's or a Home-button iPhone's status bar joins the safe area only while
// it shows, and it shows with the chrome. A centre tap that toggles it must not
// move the stage: a move re-paginates the page under the reader.

const PROSE = Array.from(
  { length: 60 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");

/** The safe area the host hands WebKit; a side left out stays `env()`'s 0px. */
interface Insets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

interface Row {
  name: string;
  viewport: { width: number; height: number };
  hidden: Insets;
  shown: Insets;
  /** Where `#stage` sits, chrome hidden or shown. */
  top: number;
}

const IPAD_UPRIGHT: Row = {
  name: "an iPad mini upright",
  viewport: { width: 744, height: 1133 },
  hidden: { top: 0, bottom: 20 },
  shown: { top: 24, bottom: 20 },
  top: 82,
};

const ROWS: Row[] = [
  IPAD_UPRIGHT,
  {
    name: "an iPad mini sideways",
    viewport: { width: 1133, height: 744 },
    hidden: { top: 0, bottom: 20 },
    shown: { top: 24, bottom: 20 },
    top: 82,
  },
  {
    name: "a Home-button iPhone upright",
    viewport: { width: 375, height: 667 },
    hidden: { top: 0 },
    shown: { top: 20 },
    top: 82,
  },
  {
    // The floor never adds to a notch: the inset already clears the status bar.
    name: "a Dynamic Island iPhone upright",
    viewport: { width: 402, height: 874 },
    hidden: { top: 62, bottom: 34 },
    shown: { top: 62, bottom: 34 },
    top: 120,
  },
  {
    // A phone on its side never shows a status bar, so there is nothing to floor.
    name: "an iPhone sideways",
    viewport: { width: 874, height: 402 },
    hidden: { left: 62, right: 62, bottom: 21 },
    shown: { left: 62, right: 62, bottom: 21 },
    top: 58,
  },
];

const OVERRIDE = "Emulation.setSafeAreaInsetsOverride";

/** The top inset `env()` resolves to right now, read off a throwaway probe. */
function envTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top, 0px)";
    document.body.append(probe);
    const px = parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    return px;
  });
}

/** Change the safe area, then wait for the page to see it before anything reads. */
async function setInsets(
  page: Page,
  cdp: CDPSession,
  insets: Insets,
): Promise<void> {
  await cdp.send(OVERRIDE, { insets });
  await expect.poll(() => envTop(page)).toBe(insets.top ?? 0);
}

/** Open a book under the insets the reader first opens with. */
async function openUnder(page: Page, row: Row): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  // Before the page loads, so the book first lays out under these insets.
  await cdp.send(OVERRIDE, { insets: row.hidden });
  await openGlue(page, await buildChapterEpub(PROSE));
  return cdp;
}

function stageBox(page: Page) {
  return page.evaluate(() => {
    const { top, height, left, width } = document
      .getElementById("stage")!
      .getBoundingClientRect();
    return { top, height, left, width };
  });
}

for (const row of ROWS) {
  test.describe(`iOS reader stage under ${row.name}`, () => {
    test.use({ viewport: row.viewport });

    test("stays where it is when the status bar toggles", async ({ page }) => {
      const cdp = await openUnder(page, row);
      const hidden = await stageBox(page);
      expect(hidden.top, "the stage's top band").toBe(row.top);

      await setInsets(page, cdp, row.shown);
      expect(await stageBox(page), "chrome shown").toEqual(hidden);

      await setInsets(page, cdp, row.hidden);
      expect(await stageBox(page), "chrome hidden again").toEqual(hidden);
    });
  });
}

test.describe("iOS reader relocates under an iPad mini upright", () => {
  test.use({ viewport: IPAD_UPRIGHT.viewport });

  test("reports nothing when the status bar toggles", async ({ page }) => {
    const cdp = await openUnder(page, IPAD_UPRIGHT);
    // Off the first page, where a reflow has a position to re-report.
    await page.evaluate(() =>
      (window as unknown as GlueWindow).OmnibusReader.next(),
    );
    // An absence, so a window: long enough for the turn's own relocate to
    // clear the 400ms debounce, and then for any a reflow would add.
    await page.waitForTimeout(1500);
    const before = (await relocates(page)).length;

    // Each flip gets its own window: a reflow is debounced, so a quick pair
    // would settle on the layout it started from and report nothing.
    await setInsets(page, cdp, IPAD_UPRIGHT.shown);
    await page.waitForTimeout(1500);
    await setInsets(page, cdp, IPAD_UPRIGHT.hidden);
    await page.waitForTimeout(1500);

    expect(
      (await relocates(page)).length,
      "a toggle must not re-paginate the page",
    ).toBe(before);
  });
});

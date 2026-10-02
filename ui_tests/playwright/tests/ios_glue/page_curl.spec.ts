import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/test";
import {
  buildChapterEpub,
  type GlueWindow,
  openGlue,
  relocates,
} from "../utils/ios_glue";

// The glue's half of the iOS page curl: `peek` puts a neighbouring page in
// front for the host to snapshot without moving the reader, `turnInstant`
// lands a turn the host has already drawn, and a swipe or gutter tap the host
// can curl is left to it.

const PROSE = Array.from(
  { length: 30 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");
const SHORT = "<p>The lamps along the quay were lit.</p>";
const MIDDLE = { x: 201, y: 437 };

/** Where the section is scrolled, and the offset drawn over it. */
function position(page: Page): Promise<{ scroll: number; offset: string }> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      "#stage .epub-container",
    );
    if (!container) throw new Error("no epub container");
    const view = container.firstElementChild as HTMLElement | null;
    return {
      scroll: container.scrollLeft,
      offset: view?.style.transform ?? "",
    };
  });
}

/** The horizontal shift a `translate3d(...)` offset draws. */
function shiftOf(offset: string): number {
  const match = /translate3d\((-?[\d.]+)px/.exec(offset);
  if (!match?.[1]) throw new Error(`no offset in "${offset}"`);
  return Number(match[1]);
}

function peek(page: Page, dir: number): Promise<boolean> {
  return page.evaluate(
    (d) => (window as unknown as GlueWindow).OmnibusReader.peek(d),
    dir,
  );
}

function turnInstant(page: Page, dir: number): Promise<boolean> {
  return page.evaluate(
    (d) => (window as unknown as GlueWindow).OmnibusReader.turnInstant(d),
    dir,
  );
}

function neighbourKind(page: Page, dir: number): Promise<string> {
  return page.evaluate(
    (d) => (window as unknown as GlueWindow).OmnibusReader.neighbourKind(d),
    dir,
  );
}

function whenSettled(
  page: Page,
): Promise<{ columns: number; next: string; prev: string }> {
  return page.evaluate(() =>
    (window as unknown as GlueWindow).OmnibusReader.whenSettled(),
  );
}

function setCurlReady(
  page: Page,
  ready: { on: boolean; next: boolean; prev: boolean },
): Promise<void> {
  return page.evaluate(
    (r) =>
      (window as unknown as GlueWindow).OmnibusReader.setCurlReady(
        r.on,
        r.next,
        r.prev,
      ),
    ready,
  );
}

function turnRequests(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as GlueWindow).glueTurnRequests,
  );
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

/**
 * A one-finger swipe leftward from the middle of the page. Returns the offset
 * drawn mid-swipe, with a frame let run after each move so a drag the glue
 * took would have painted one.
 */
async function swipeLeft(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  const at = (dx: number) => [{ x: MIDDLE.x + dx, y: MIDDLE.y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: at(0),
  });
  for (const dx of [-30, -90, -160]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: at(dx),
    });
    await nextFrame(page);
  }
  const midSwipe = (await position(page)).offset;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  return midSwipe;
}

test.describe("iOS reader page curl: peeking and landing", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test("a peek shows the next page without moving the reader, and the turn lands on that page", async ({
    page,
  }) => {
    await openGlue(page, await buildChapterEpub(PROSE));
    const before = await position(page);
    const cfiBefore = (await relocates(page)).at(-1)?.cfi;

    expect(await peek(page, 1)).toBe(true);
    const peeked = await position(page);
    expect(peeked.scroll, "a peek leaves epub.js where it was").toBe(
      before.scroll,
    );
    const shift = -shiftOf(peeked.offset);
    expect(shift).toBeGreaterThan(0);

    expect(await peek(page, 0)).toBe(true);
    expect((await position(page)).offset).toBe("");

    expect(await turnInstant(page, 1)).toBe(true);
    const landed = await position(page);
    expect(landed.scroll, "the turn lands on the page the peek showed").toBe(
      before.scroll + shift,
    );
    expect(landed.offset).toBe("");
    const last = (await relocates(page)).at(-1);
    expect(last?.cfi).not.toBe(cfiBefore);
    expect(last?.echo, "a landed turn is movement").toBe(false);
  });

  test("a capture waits out a slide still drawing, so it never snapshots a page mid-turn", async ({
    page,
  }) => {
    await openGlue(page, await buildChapterEpub(PROSE));
    const before = await position(page);

    await page.evaluate(() =>
      (window as unknown as GlueWindow).OmnibusReader.turnSlide(1),
    );
    expect((await whenSettled(page)).columns).toBe(1);

    const settled = await position(page);
    expect(settled.offset, "no slide is still drawing").toBe("");
    expect(settled.scroll).toBeGreaterThan(before.scroll);
  });

  test("before the book's first page there is nothing to peek at or turn to", async ({
    page,
  }) => {
    await openGlue(page, await buildChapterEpub(PROSE));
    const before = await position(page);

    expect(await neighbourKind(page, -1)).toBe("none");
    expect(await peek(page, -1)).toBe(false);
    expect(await turnInstant(page, -1)).toBe(false);
    expect(await position(page)).toEqual(before);
  });

  test("at a chapter's end the next page is across a section, and the turn crosses into it", async ({
    page,
  }) => {
    const epub = await buildChapterEpub(SHORT, {
      chapters: [PROSE],
      toc: [
        ["One", "chapter.xhtml"],
        ["Two", "chapter2.xhtml"],
      ],
    });
    await openGlue(page, epub);

    expect(await whenSettled(page), "what the host decides by").toEqual({
      columns: 1,
      next: "section",
      prev: "none",
    });
    expect(await neighbourKind(page, 1)).toBe("section");
    expect(await peek(page, 1), "an unlaid chapter has no pixels").toBe(false);

    expect(await turnInstant(page, 1)).toBe(true);
    await expect
      .poll(async () => (await relocates(page)).at(-1)?.chapterTitle)
      .toBe("Two");
    expect(await neighbourKind(page, -1)).toBe("section");
  });
});

test.describe("iOS reader page curl: who turns the page", () => {
  test.use({ viewport: { width: 402, height: 874 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await openGlue(page, await buildChapterEpub(PROSE));
  });

  test("a swipe toward a page the host can curl is left to it, and one it can't is still the slide", async ({
    page,
  }) => {
    const before = await position(page);

    await setCurlReady(page, { on: true, next: true, prev: false });
    expect(await swipeLeft(page), "the glue drew no drag").toBe("");
    expect((await position(page)).scroll).toBe(before.scroll);

    await setCurlReady(page, { on: true, next: false, prev: false });
    expect(await swipeLeft(page), "the glue drew the drag").not.toBe("");
    await expect
      .poll(async () => (await position(page)).scroll)
      .toBeGreaterThan(before.scroll);
  });

  test("a touch during a peek can't drag the shifted page, but a tap still reaches the host", async ({
    page,
  }) => {
    // Swipes are the glue's here, so only the peek can be what holds one off.
    await setCurlReady(page, { on: true, next: false, prev: false });
    expect(await peek(page, 1)).toBe(true);
    const peeked = await position(page);

    expect(await swipeLeft(page), "the peek's shift stands").toBe(
      peeked.offset,
    );
    expect(await position(page)).toEqual(peeked);

    await page.touchscreen.tap(380, MIDDLE.y);
    await expect.poll(() => turnRequests(page)).toEqual(["1"]);
  });

  test("a gutter tap is the host's to draw while it curls, and the glue's slide otherwise", async ({
    page,
  }) => {
    const before = await position(page);

    await setCurlReady(page, { on: true, next: false, prev: false });
    await page.touchscreen.tap(380, MIDDLE.y);
    await page.touchscreen.tap(20, MIDDLE.y);
    await expect.poll(() => turnRequests(page)).toEqual(["1", "-1"]);
    expect((await position(page)).scroll).toBe(before.scroll);

    await setCurlReady(page, { on: false, next: false, prev: false });
    await page.touchscreen.tap(380, MIDDLE.y);
    await expect
      .poll(async () => (await position(page)).scroll)
      .toBeGreaterThan(before.scroll);
    expect(await turnRequests(page)).toEqual(["1", "-1"]);
  });
});

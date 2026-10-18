import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";

import type {
  Direction,
  GlueOptions,
  GlueWindow,
  Point,
  RelocatePayload,
  SelectionPayload,
  Settled,
} from "../data/iosGlue";
import { BasePage } from "./BasePage";

const GLUE_ORIGIN = "http://ios-glue.test";
const GLUE_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "omnibus-ios",
  "omnibus",
  "Reader",
  "Web",
);
const GLUE_FILES = new Set([
  "reader.html",
  "jszip.min.js",
  "epub.min.js",
  "epub-reader-glue.js",
]);

// The middle and the page-turn gutters of the 402x874 window the touch specs use.
const MIDDLE: Point = { x: 201, y: 437 };
const NEXT_GUTTER_X = 380;
const PREVIOUS_GUTTER_X = 20;

/**
 * The iOS app's reader web view (`omnibus-ios/omnibus/Reader/Web/`), driven
 * through the entry points the Swift host calls. Not the web app: it has no
 * hydration, so it opens itself rather than through `BasePage.open`.
 */
export class IosGluePage extends BasePage {
  protected readonly urlPattern = /ios-glue\.test\/reader\.html$/;

  readonly stageFrame: Locator;

  constructor(page: Page) {
    super(page);
    this.stageFrame = page.locator("#stage iframe");
  }

  protected get readyLocator(): Locator {
    return this.stageFrame;
  }

  /**
   * Serves the reader page byte for byte off disk on a routed origin, opens
   * `epub` in it as the host does, and resolves once the glue reports `ready`.
   */
  async openBook(epub: Buffer, options: GlueOptions = {}): Promise<void> {
    await this.page.route(`${GLUE_ORIGIN}/**`, (route) => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (file === "book.epub") {
        return route.fulfill({
          body: epub,
          contentType: "application/epub+zip",
        });
      }
      if (GLUE_FILES.has(file)) {
        return route.fulfill({ path: resolve(GLUE_DIR, file) });
      }
      return route.fulfill({ status: 404 });
    });
    await this.page.goto(`${GLUE_ORIGIN}/reader.html`);
    // The page's own callbacks post to a WKWebView message handler that is not
    // here; replace them with ones that keep what the glue reports.
    await this.page.evaluate((options) => {
      const w = window as unknown as GlueWindow;
      w.glueSelections = [];
      w.glueRelocates = [];
      w.glueTurnRequests = [];
      w.glueStatus = null;
      w.__omnibusOnSelection = (json) => {
        w.glueSelections.push(JSON.parse(json));
      };
      w.__omnibusOnRelocate = (json) => {
        w.glueRelocates.push(JSON.parse(json));
      };
      w.__omnibusOnStatus = (state) => {
        w.glueStatus = state;
      };
      w.__omnibusOnTurnRequest = (dir) => {
        w.glueTurnRequests.push(dir);
      };
      w.OmnibusReader.init("stage", "/book.epub", {
        theme: "light",
        fontSize: 18,
        spread: "none",
        allowScriptedContent: true,
        ...options,
      });
    }, options);
    await this.page.waitForFunction(
      () => (window as unknown as GlueWindow).glueStatus === "ready",
    );
  }

  /** Holds the book frame's `document.fonts.ready` for `ms`; call before `openBook`. */
  async holdFontsReady(ms: number): Promise<void> {
    await this.page.addInitScript((ms) => {
      if (window === window.top) return;
      Object.defineProperty(FontFaceSet.prototype, "ready", {
        get: () => new Promise((resolve) => setTimeout(resolve, ms)),
      });
    }, ms);
  }

  async setSpread(mode: "none" | "auto"): Promise<void> {
    await this.page.evaluate(
      (mode) => (window as unknown as GlueWindow).OmnibusReader.setSpread(mode),
      mode,
    );
  }

  /** Resizes the host window; the stage is that less 10px a side. */
  async resizeWindow(size: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(size);
  }

  /** The host's page-turn entry point. */
  async next(): Promise<void> {
    await this.page.evaluate(() =>
      (window as unknown as GlueWindow).OmnibusReader.next(),
    );
  }

  async turnSlide(dir: Direction): Promise<void> {
    await this.page.evaluate(
      (dir) => (window as unknown as GlueWindow).OmnibusReader.turnSlide(dir),
      dir,
    );
  }

  /** Resolves true once the neighbouring page is in front, false if none can be. */
  async peek(dir: Direction): Promise<boolean> {
    return this.page.evaluate(
      (dir) => (window as unknown as GlueWindow).OmnibusReader.peek(dir),
      dir,
    );
  }

  /** Puts the page back after a `peek`. */
  async unpeek(): Promise<boolean> {
    return this.page.evaluate(() =>
      (window as unknown as GlueWindow).OmnibusReader.peek(0),
    );
  }

  /** Lands a turn the host already drew; resolves false with no page to land on. */
  async turnInstant(dir: Direction): Promise<boolean> {
    return this.page.evaluate(
      (dir) => (window as unknown as GlueWindow).OmnibusReader.turnInstant(dir),
      dir,
    );
  }

  /** Tells the glue whether the host is curling, and toward which pages. */
  async setCurlReady(ready: {
    on: boolean;
    next: boolean;
    prev: boolean;
  }): Promise<void> {
    await this.page.evaluate(
      (ready) =>
        (window as unknown as GlueWindow).OmnibusReader.setCurlReady(
          ready.on,
          ready.next,
          ready.prev,
        ),
      ready,
    );
  }

  /** Long-presses `from`, drags to `to` (by the word) when given, and lifts. */
  async dragSelect(from: Point, to?: Point): Promise<void> {
    await this.page.evaluate(
      ([from, to]) => {
        const reader = (window as unknown as GlueWindow).OmnibusReader;
        if (!reader.beginSelectionAt(from.x, from.y)) {
          throw new Error("the press selected nothing");
        }
        if (to) reader.extendSelectionTo(to.x, to.y);
        reader.endSelectionDrag();
      },
      [from, to] as const,
    );
  }

  /**
   * A one-finger swipe leftward from the middle of the page. Returns the offset
   * drawn mid-swipe, which is gone once the finger lifts.
   */
  async swipeLeft(): Promise<string> {
    const cdp = await this.page.context().newCDPSession(this.page);
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
      // A drag offset lands in a rAF callback, so a frame must run per move.
      await this.nextFrame();
    }
    const midSwipe = (await this.sectionPosition()).offset;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    return midSwipe;
  }

  async tapNextGutter(): Promise<void> {
    await this.page.touchscreen.tap(NEXT_GUTTER_X, MIDDLE.y);
  }

  async tapPreviousGutter(): Promise<void> {
    await this.page.touchscreen.tap(PREVIOUS_GUTTER_X, MIDDLE.y);
  }

  /** A restore always reports where it landed, so the first relocate marks it. */
  async waitForFirstRelocate(): Promise<void> {
    await this.page.waitForFunction(
      () => (window as unknown as GlueWindow).glueRelocates.length > 0,
    );
  }

  /** An absence needs a window: long enough to clear the 400ms relocate debounce. */
  async waitOutRelocateDebounce(): Promise<void> {
    await this.page.waitForTimeout(1500);
  }

  /** Every relocate the glue has reported so far. */
  async relocates(): Promise<RelocatePayload[]> {
    return this.page.evaluate(
      () => (window as unknown as GlueWindow).glueRelocates,
    );
  }

  /** The relocates that report movement, not an echo of a restored position. */
  async movements(): Promise<RelocatePayload[]> {
    return (await this.relocates()).filter((relocate) => !relocate.echo);
  }

  /** The directions the glue has asked the host to turn the page in. */
  async turnRequests(): Promise<string[]> {
    return this.page.evaluate(
      () => (window as unknown as GlueWindow).glueTurnRequests,
    );
  }

  /** The last settled selection payload, which a highlight is created from. */
  async settledSelection(): Promise<SelectionPayload> {
    const all = await this.page.evaluate(
      () => (window as unknown as GlueWindow).glueSelections,
    );
    const last = all.filter((selection) => !selection.dragging).at(-1);
    if (!last) throw new Error("no settled selection was reported");
    return last;
  }

  /** The centre of `word` in the book element `id`, in host-window coordinates. */
  async wordPoint(id: string, word: string): Promise<Point> {
    return this.page.evaluate(
      ([id, word]) => {
        const frame =
          document.querySelector<HTMLIFrameElement>("#stage iframe");
        const doc = frame?.contentDocument;
        const para = doc?.getElementById(id);
        if (!frame || !doc || !para) throw new Error(`no paragraph #${id}`);
        const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = (n as Text).data.indexOf(word);
          if (at < 0) continue;
          const range = doc.createRange();
          range.setStart(n, at);
          range.setEnd(n, at + word.length);
          const box = range.getBoundingClientRect();
          const off = frame.getBoundingClientRect();
          return {
            x: off.left + box.left + box.width / 2,
            y: off.top + box.top + box.height / 2,
          };
        }
        throw new Error(`no "${word}" in #${id}`);
      },
      [id, word] as const,
    );
  }

  /** The book element `id`'s box, in host-window coordinates like the rows. */
  async hostBox(
    id: string,
  ): Promise<{ top: number; bottom: number; lineHeight: number }> {
    return this.page.evaluate((id) => {
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

  /** The raw DOM text of the range a selection's CFI names. */
  async rangeText(cfiRange: string): Promise<string> {
    return this.page.evaluate((cfi) => {
      const w = window as unknown as GlueWindow;
      const frame = document.querySelector<HTMLIFrameElement>("#stage iframe");
      const doc = frame?.contentDocument;
      if (!doc) throw new Error("no section document");
      return new w.ePub.CFI(cfi).toRange(doc).toString();
    }, cfiRange);
  }

  /** What lies `dir` of this page: a page of the section, another section, or none. */
  async neighbourKind(dir: Direction): Promise<"page" | "section" | "none"> {
    return this.page.evaluate(
      (dir) =>
        (window as unknown as GlueWindow).OmnibusReader.neighbourKind(dir),
      dir,
    );
  }

  /** What the host decides a curl by, once a slide still drawing has finished. */
  async whenSettled(): Promise<Settled> {
    return this.page.evaluate(() =>
      (window as unknown as GlueWindow).OmnibusReader.whenSettled(),
    );
  }

  async columns(): Promise<number> {
    return (await this.whenSettled()).columns;
  }

  /** Where the section is scrolled, and the offset drawn over it. */
  async sectionPosition(): Promise<{ scroll: number; offset: string }> {
    return this.page.evaluate(() => {
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

  /** How far left the drawn offset has shifted the page, in px. */
  async peekDistance(): Promise<number> {
    const { offset } = await this.sectionPosition();
    const match = /translate3d\((-?[\d.]+)px/.exec(offset);
    if (!match?.[1]) throw new Error(`no offset in "${offset}"`);
    return -Number(match[1]);
  }

  private async nextFrame(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
}

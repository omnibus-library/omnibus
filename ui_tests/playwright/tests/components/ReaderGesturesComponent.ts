import type { CDPSession, Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

type TouchPoint = { x: number; y: number; id: number };

/**
 * Touch input on the reader, through CDP because Playwright's touchscreen
 * drives one point. The page needs `hasTouch`, or Chromium sends mouse events
 * and the page's touch listeners never run.
 */
export class ReaderGesturesComponent extends BaseComponent {
  private readonly topBar: Locator;

  /** The session between `startDragAcrossPage` and `joinDragFromTopBar`. */
  private drag: CDPSession | undefined;

  constructor(page: Page) {
    super(page);
    this.topBar = page.getByTestId("reader-top");
  }

  /**
   * One finger in the forward gutter: how a touch reader turns the page. The
   * round page-turn buttons are suppressed in a touch context.
   */
  async tapForward(): Promise<void> {
    const { x, y } = this.forwardGutter();
    await this.page.touchscreen.tap(x, y);
  }

  /**
   * Two fingers land on the top bar together, slide down, and lift one at a
   * time, as a hand does. The first lifts while the second still slides.
   */
  async swipeTwoFingersDownTopBar(): Promise<void> {
    const cdp = await this.page.context().newCDPSession(this.page);
    const from = await this.topBarCentre();
    const fingers = (progress: number) => twoFingers(from, 24 * progress);
    await touch(cdp, "touchStart", fingers(0));
    for (let step = 1; step <= 3; step++) {
      await touch(cdp, "touchMove", fingers(step / 6));
    }
    const [first] = fingers(0.5);
    await touch(cdp, "touchEnd", [first]);
    for (let step = 4; step <= 6; step++) {
      const [, second] = fingers(step / 6);
      await touch(cdp, "touchMove", [second]);
    }
    await touch(cdp, "touchEnd", []);
    await cdp.detach();
  }

  /**
   * Puts one finger on the page and drags it left, leaving the page
   * part-turned. A frame runs after each move: the drag offset lands in a
   * rAF callback, so back-to-back points would never paint one.
   */
  async startDragAcrossPage(): Promise<void> {
    const size = this.viewport();
    const finger = (dx: number) => ({
      x: size.width / 2 + dx,
      y: size.height / 2,
      id: 1,
    });
    const cdp = await this.page.context().newCDPSession(this.page);
    this.drag = cdp;
    await touch(cdp, "touchStart", [finger(0)]);
    for (const dx of [-20, -45, -70]) {
      await touch(cdp, "touchMove", [finger(dx)]);
      await this.nextFrame();
    }
  }

  /**
   * Lands a second finger on the top bar, then lifts both one at a time. The
   * bar is another document, so the handler holding the drag never sees that
   * touchstart and learns of it only from a lift with a finger still down.
   */
  async joinDragFromTopBar(): Promise<void> {
    const cdp = this.drag;
    if (!cdp) throw new Error("start a drag before joining it");
    const size = this.viewport();
    const bar = await this.topBarCentre();
    const first = { x: size.width / 2 - 70, y: size.height / 2, id: 1 };
    await touch(cdp, "touchStart", [first, { ...bar, id: 2 }]);
    await touch(cdp, "touchEnd", [first]);
    await touch(cdp, "touchEnd", []);
    await cdp.detach();
    this.drag = undefined;
  }

  /**
   * Two fingers the system takes away mid-gesture, a Control Center pull or a
   * call, which arrives as `touchcancel` rather than a lift.
   */
  async cancelTwoFingersOnForwardGutter(): Promise<void> {
    const cdp = await this.page.context().newCDPSession(this.page);
    const from = this.forwardGutter();
    await touch(cdp, "touchStart", twoFingers(from, 0));
    await touch(cdp, "touchMove", twoFingers(from, 12));
    await touch(cdp, "touchCancel", []);
    await cdp.detach();
  }

  /**
   * Every `style.transform` left on a page view. `setViewOffset` writes the
   * drag offset there, so a non-empty list after a gesture is a page stranded
   * part-turned, which the page label cannot show.
   */
  strandedOffsets(): Promise<string[]> {
    return this.page.evaluate(() => {
      const mount = document.querySelector('[data-testid="reader-viewer"]');
      const container = mount?.querySelector("div");
      // Thrown, not reported as an offset: returned, it would pass the "a drag
      // was armed" check and fail confusingly two assertions later.
      if (!container) throw new Error("no page container under reader-viewer");
      return Array.from(container.children)
        .map((child) => (child as HTMLElement).style.transform)
        .filter((transform) => transform !== "" && transform !== "none");
    });
  }

  private viewport(): { width: number; height: number } {
    const size = this.page.viewportSize();
    if (!size) throw new Error("the reader gestures need a viewport");
    return size;
  }

  private forwardGutter(): { x: number; y: number } {
    const size = this.viewport();
    return { x: size.width * 0.92, y: size.height / 2 };
  }

  private async topBarCentre(): Promise<{ x: number; y: number }> {
    const box = await this.topBar.boundingBox();
    if (!box) throw new Error("reader-top has no bounding box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Lets one animation frame run. Not a sleep: it resolves on the frame. */
  private async nextFrame(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
}

/** Two fingers side by side, `dy` below where they landed. */
function twoFingers(
  from: { x: number; y: number },
  dy: number,
): [TouchPoint, TouchPoint] {
  return [
    { x: from.x, y: from.y + dy, id: 1 },
    { x: from.x + 36, y: from.y + 6 + dy, id: 2 },
  ];
}

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
  touchPoints: TouchPoint[],
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
}

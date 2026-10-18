import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The hero's unread, reading and finished segments, and the line under them. */
export class ReadStatusControlComponent extends BaseComponent {
  readonly root: Locator;
  readonly unreadSegment: Locator;
  readonly readingSegment: Locator;
  readonly finishedSegment: Locator;
  readonly meta: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("read-status-control");
    this.unreadSegment = this.root.getByTestId("read-status-unread");
    this.readingSegment = this.root.getByTestId("read-status-reading");
    this.finishedSegment = this.root.getByTestId("read-status-finished");
    this.meta = page.getByTestId("read-status-meta");
  }

  async markUnread(): Promise<void> {
    await this.unreadSegment.click();
  }

  async markReading(): Promise<void> {
    await this.readingSegment.click();
  }

  async markFinished(): Promise<void> {
    await this.finishedSegment.click();
  }
}

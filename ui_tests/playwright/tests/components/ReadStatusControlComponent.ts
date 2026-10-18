import type { Locator, Page } from "@playwright/test";
import { readStatusUrls } from "../contracts/readStatus";
import type { ReadStatus } from "../data/readStatus";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

const LABELS: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};

/** The three-segment read status control in the hero, and the line under it. */
export class ReadStatusControlComponent extends BaseComponent {
  readonly root: Locator;
  readonly metaText: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("read-status-control");
    this.metaText = this.root.getByRole("status");
  }

  segmentButton(status: ReadStatus): Locator {
    return this.root.getByRole("button", {
      name: LABELS[status],
      exact: true,
    });
  }

  /** Clicks the segment and waits for the save; the active one sends nothing. */
  async mark(status: ReadStatus): Promise<void> {
    const saved = this.page.waitForResponse(isPostTo(readStatusUrls.set));
    await this.segmentButton(status).click();
    await saved;
  }
}

import type { Locator, Page, Response } from "@playwright/test";
import { readStatusUrls } from "../contracts/readStatus";
import type { ReadStatus } from "../data/readStatus";
import { BaseComponent } from "./BaseComponent";

export const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};

const isReadStatusPut = (response: Response) =>
  response.request().method() === "PUT" &&
  readStatusUrls.set.test(response.url());

/** The hero's read status pill, the menu of three statuses it opens, and its error line. */
export class ReadStatusControlComponent extends BaseComponent {
  readonly root: Locator;
  /** Named "Read status: <status>", so its name is the saved status. */
  readonly pill: Locator;
  readonly menu: Locator;
  readonly errorText: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("read-status-control");
    this.pill = this.root.getByRole("button", { name: /^Read status:/ });
    this.menu = page.getByRole("menu", { name: "Read status" });
    this.errorText = page.getByTestId("read-status-meta");
  }

  /** The menu's item for `status`; its name carries a finished date, so it is found by test id. */
  option(status: ReadStatus): Locator {
    return this.menu.getByTestId(`read-status-${status}`);
  }

  async openMenu(): Promise<void> {
    await this.pill.click();
  }

  /** Picks `status` from the menu and waits for the save; the checked one sends nothing. */
  async mark(status: ReadStatus): Promise<void> {
    await this.openMenu();
    const saved = this.page.waitForResponse(isReadStatusPut);
    await this.option(status).click();
    await saved;
  }
}

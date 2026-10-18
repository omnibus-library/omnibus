import type { Locator, Page } from "@playwright/test";
import { settingsUrls } from "../contracts/settings";
import { BaseComponent } from "./BaseComponent";

/** Administration › Maintenance: the library scan, the EPUB bake and the task list. */
export class MaintenanceSectionComponent extends BaseComponent {
  readonly card: Locator;
  readonly backgroundTasksCard: Locator;
  readonly scanButton: Locator;
  readonly bakeEpubOverridesButton: Locator;
  readonly status: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("maintenance-card");
    this.backgroundTasksCard = page.getByTestId("background-tasks-card");
    this.scanButton = page.getByTestId("scan-library");
    this.bakeEpubOverridesButton = page.getByTestId("rewrite-all-epubs");
    // The commands report on their own line, apart from the library form's.
    this.status = page.getByTestId("maintenance-status");
  }

  async startScan(): Promise<void> {
    await this.scanButton.click();
  }

  async bakeEpubOverrides(): Promise<void> {
    await this.bakeEpubOverridesButton.click();
  }

  /** Answers the bulk EPUB bake as queued, so no book file is rewritten. */
  async stubBakeQueued(): Promise<void> {
    await this.page.route(settingsUrls.rewriteAllEpubs, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "null",
          })
        : route.continue(),
    );
  }
}

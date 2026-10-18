import type { Locator, Page } from "@playwright/test";
import { workerStatusUrls } from "../contracts/workerStatus";
import type { WorkerStatus } from "../data/workerStatus";
import { BaseComponent } from "./BaseComponent";

/** The background-task indicator in Administration › Maintenance. */
export class WorkerStatusComponent extends BaseComponent {
  readonly indicator: Locator;
  readonly phase: Locator;
  readonly currentItem: Locator;
  readonly tallies: Locator;
  readonly summary: Locator;
  readonly failureAlert: Locator;
  readonly dismissButton: Locator;

  private served: WorkerStatus = { active: [], recent_complete: [] };

  constructor(page: Page) {
    super(page);
    this.indicator = page.getByTestId("worker-status");
    this.phase = page.getByTestId("worker-status-phase");
    this.currentItem = page.getByTestId("worker-status-item");
    this.tallies = page.getByTestId("worker-status-tallies");
    this.summary = page.getByTestId("worker-status-summary");
    this.failureAlert = page.getByRole("alert");
    this.dismissButton = page.getByRole("button", { name: "Dismiss" });
  }

  /** Answers every poll with `status`, so no test waits on a real scan. */
  async stubStatus(status: WorkerStatus): Promise<void> {
    this.served = status;
    await this.page.route(workerStatusUrls.poll, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(this.served),
      }),
    );
  }

  /** Answers the polls from now on with `status`, as the worker moves on. */
  changeStatus(status: WorkerStatus): void {
    this.served = status;
  }

  async dismiss(): Promise<void> {
    await this.dismissButton.click();
  }
}

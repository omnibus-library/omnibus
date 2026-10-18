import type { Locator, Page, Response } from "@playwright/test";
import { adminHealthUrls } from "../contracts/adminHealth";
import type { AdminHealthReport } from "../data/adminHealth";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

const isPoll = isPostTo(adminHealthUrls.poll);

/** A poll the server answered with a report. */
const isAnsweredPoll = (response: Response) =>
  isPoll(response) && response.status() === 200;

/** Administration › Health: the server report, re-read every five seconds. */
export class HealthSectionComponent extends BaseComponent {
  readonly root: Locator;
  readonly heading: Locator;
  readonly grid: Locator;
  readonly indexCard: Locator;
  readonly indexHeading: Locator;
  readonly booksIndexed: Locator;
  readonly ghostedOk: Locator;
  readonly ghostedWarning: Locator;
  readonly workerHeading: Locator;
  readonly workerEmpty: Locator;
  readonly workerTable: Locator;
  readonly workerRow: Locator;
  readonly ftsCard: Locator;
  readonly ftsHeading: Locator;
  readonly storageCard: Locator;
  readonly storageHeading: Locator;
  readonly errorsHeading: Locator;
  readonly errorsEmpty: Locator;
  readonly errorsTable: Locator;
  readonly errorsRow: Locator;
  readonly errorsRowBookLink: Locator;
  readonly errorsRowFile: Locator;

  private served?: AdminHealthReport;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("admin-health-page");
    this.heading = page.getByRole("heading", { level: 2, name: "Health" });
    this.grid = page.getByTestId("admin-health-grid");
    this.indexCard = page.getByTestId("admin-health-index-card");
    this.indexHeading = this.indexCard.getByRole("heading", {
      level: 3,
      name: "Index status",
    });
    // The stat rows carry no test id, so the label and value classes are the way in.
    this.booksIndexed = this.indexCard
      .locator(".ah-kv-row", { hasText: "Books indexed" })
      .locator(".ah-kv-value");
    this.ghostedOk = page.getByTestId("admin-health-ghosted-ok");
    this.ghostedWarning = page.getByTestId("admin-health-ghosted-warning");
    this.workerHeading = page
      .getByTestId("admin-health-worker-card")
      .getByRole("heading", { level: 3, name: "Worker queue" });
    this.workerEmpty = page.getByTestId("admin-health-worker-empty");
    this.workerTable = page.getByTestId("admin-health-worker-table");
    this.workerRow = page.getByTestId("admin-health-worker-row");
    this.ftsCard = page.getByTestId("admin-health-fts-card");
    this.ftsHeading = this.ftsCard.getByRole("heading", {
      level: 3,
      name: "Search index (FTS)",
    });
    this.storageCard = page.getByTestId("admin-health-storage-card");
    this.storageHeading = this.storageCard.getByRole("heading", {
      level: 3,
      name: "Storage",
    });
    this.errorsHeading = page
      .getByTestId("admin-health-errors-card")
      .getByRole("heading", { level: 3, name: "Last errors" });
    this.errorsEmpty = page.getByTestId("admin-health-errors-empty");
    this.errorsTable = page.getByTestId("admin-health-errors-table");
    this.errorsRow = page.getByTestId("admin-health-errors-row");
    this.errorsRowBookLink = this.errorsRow.getByRole("link", {
      name: "Open book",
    });
    this.errorsRowFile = this.errorsRow.getByTestId("admin-health-errors-file");
  }

  /** Answers every poll with `report`, so a count can only change when a test says. */
  async stubReport(report: AdminHealthReport): Promise<void> {
    this.served = report;
    await this.page.route(adminHealthUrls.poll, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(this.served),
      }),
    );
  }

  /** Answers the polls from now on with `report`, and waits for the next one. */
  async serveReport(report: AdminHealthReport): Promise<void> {
    const nextPoll = this.page.waitForResponse(isAnsweredPoll);
    this.served = report;
    await nextPoll;
  }
}

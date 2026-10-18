import type { Locator, Page, Response } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { adminHealthUrls } from "../contracts/adminHealth";
import type { AdminHealthReport } from "../data/adminHealth";
import { isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";

const isPoll = isPostTo(adminHealthUrls.poll);

/** A poll the server answered with a report. */
const isAnsweredPoll = (response: Response) =>
  isPoll(response) && response.status() === 200;

/** The server-health page, which re-reads its report every five seconds. */
export class AdminHealthPage extends BasePage {
  protected readonly urlPattern = /\/admin\/health$/;

  readonly topNav: TopNavComponent;
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

  private served?: AdminHealthReport;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.heading = page.getByRole("heading", {
      level: 1,
      name: "Server health",
    });
    this.grid = page.getByTestId("admin-health-grid");
    this.indexCard = page.getByTestId("admin-health-index-card");
    this.indexHeading = this.indexCard.getByRole("heading", {
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
      .getByRole("heading", {
        name: "Worker queue",
      });
    this.workerEmpty = page.getByTestId("admin-health-worker-empty");
    this.workerTable = page.getByTestId("admin-health-worker-table");
    this.workerRow = page.getByTestId("admin-health-worker-row");
    this.ftsCard = page.getByTestId("admin-health-fts-card");
    this.ftsHeading = this.ftsCard.getByRole("heading", {
      name: "Search index (FTS)",
    });
    this.storageCard = page.getByTestId("admin-health-storage-card");
    this.storageHeading = this.storageCard.getByRole("heading", {
      name: "Storage",
    });
    this.errorsHeading = page
      .getByTestId("admin-health-errors-card")
      .getByRole("heading", {
        name: "Last errors",
      });
    this.errorsEmpty = page.getByTestId("admin-health-errors-empty");
    this.errorsTable = page.getByTestId("admin-health-errors-table");
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  /** Opens the page and waits for the poll loop's first report. */
  async goto(): Promise<void> {
    const firstPoll = this.page.waitForResponse(isAnsweredPoll);
    await this.openAndSettle("/admin/health");
    await firstPoll;
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

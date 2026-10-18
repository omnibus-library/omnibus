import type { Locator, Page } from "@playwright/test";
import { logsUrls } from "../contracts/logs";
import type { LogPage } from "../data/logs";
import { BaseComponent } from "./BaseComponent";

/** Settings → Logs: the admin viewer over the server's on-disk JSON logs. */
export class LogsSectionComponent extends BaseComponent {
  readonly root: Locator;
  readonly heading: Locator;
  readonly levelFilter: Locator;
  readonly moduleFilter: Locator;
  readonly fromField: Locator;
  readonly toField: Locator;
  readonly applyButton: Locator;
  readonly table: Locator;
  readonly rows: Locator;
  readonly firstRow: Locator;
  readonly pageIndicator: Locator;
  readonly olderButton: Locator;
  readonly newerButton: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("logs-page");
    this.heading = page.getByRole("heading", { level: 2, name: "Server logs" });
    this.levelFilter = page.getByLabel("Level");
    this.moduleFilter = page.getByLabel("Module");
    this.fromField = page.getByLabel("From");
    this.toField = page.getByLabel("To");
    this.applyButton = page.getByTestId("logs-apply");
    this.table = page.getByTestId("logs-table");
    this.rows = page.getByTestId("logs-row");
    this.firstRow = this.rows.first();
    this.pageIndicator = page.getByTestId("logs-page-indicator");
    this.olderButton = page.getByTestId("logs-next");
    this.newerButton = page.getByTestId("logs-prev");
    this.error = page.getByTestId("logs-error");
  }

  /** The level text a listed record shows. */
  levelText(level: string): Locator {
    return this.page.getByText(level, { exact: true });
  }

  async selectLevel(level: string): Promise<void> {
    await this.levelFilter.selectOption(level);
  }

  async filterModule(module: string): Promise<void> {
    await this.moduleFilter.fill(module);
  }

  async apply(): Promise<void> {
    await this.applyButton.click();
  }

  async showOlder(): Promise<void> {
    await this.olderButton.click();
  }

  async showNewer(): Promise<void> {
    await this.newerButton.click();
  }

  /** Answers every read with one page, or with the page the query asks for. */
  async stubLogs(
    pages: LogPage | ((requestedPage: number) => LogPage),
  ): Promise<void> {
    await this.page.route(logsUrls.read, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const requestedPage = route.request().postDataJSON()?.query?.page ?? 0;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          typeof pages === "function" ? pages(requestedPage) : pages,
        ),
      });
    });
  }
}

import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** The authors index at `/authors`. */
export class AuthorsIndexPage extends BasePage {
  protected readonly urlPattern = /\/authors$/;

  readonly topNav: TopNavComponent;

  readonly filterField: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.filterField = page.getByTestId("authors-filter");
  }

  protected get readyLocator(): Locator {
    return this.filterField;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/authors");
  }

  /** Returns once the server-rendered HTML arrives, before the client runs. */
  async gotoBeforeHydration(): Promise<void> {
    await this.page.goto("/authors", { waitUntil: "domcontentloaded" });
  }
}

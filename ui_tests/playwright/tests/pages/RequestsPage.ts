import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** Every reader's book requests at `/requests`. */
export class RequestsPage extends BasePage {
  protected readonly urlPattern = /\/requests$/;

  readonly topNav: TopNavComponent;

  readonly root: Locator;
  readonly heading: Locator;
  readonly rows: Locator;
  readonly bookFilter: Locator;
  readonly cancelButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.root = page.getByTestId("requests-page");
    this.heading = page.getByRole("heading", { level: 1, name: "Requests" });
    this.rows = page.getByTestId("requests-row");
    this.bookFilter = page.getByRole("searchbox", { name: "Filter by book" });
    this.cancelButtons = page.getByTestId("requests-cancel");
  }

  protected get readyLocator(): Locator {
    return this.root;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/requests");
  }

  /** Narrows the list to books whose title or author holds `text`. */
  async filterByBook(text: string): Promise<void> {
    await this.bookFilter.fill(text);
  }

  /** The rows for the book called `title`. */
  rowsFor(title: string): Locator {
    return this.rows.filter({
      has: this.page.getByRole("link", { name: title, exact: true }),
    });
  }

  /** The Cancel button on `title`'s only row. */
  cancelFor(title: string): Locator {
    return this.page.getByRole("button", {
      name: `Cancel the request for ${title}`,
    });
  }

  async cancel(title: string): Promise<void> {
    await this.cancelFor(title).click();
  }
}

import type { Locator, Page } from "@playwright/test";
import { overridesUrls } from "../contracts/overrides";
import { summaryUrls } from "../contracts/summary";
import { BaseComponent } from "./BaseComponent";

/** The hero's description, and the button that fetches one when it is sparse. */
export class BookSummaryComponent extends BaseComponent {
  readonly fetchButton: Locator;
  readonly description: Locator;
  readonly expandToggle: Locator;

  constructor(page: Page) {
    super(page);
    this.fetchButton = page.getByTestId("fetch-summary");
    this.description = page.getByTestId("book-description");
    this.expandToggle = page.getByTestId("book-description-toggle");
  }

  async fetchSummary(): Promise<void> {
    await this.fetchButton.click();
  }

  async focusExpandToggle(): Promise<void> {
    await this.expandToggle.focus();
  }

  async pressExpandToggle(): Promise<void> {
    await this.expandToggle.press("Enter");
  }

  /** Whether the whole blurb is laid out, not only the clamped lines. */
  async showsWholeDescription(): Promise<boolean> {
    return this.description.evaluate(
      (element) => element.scrollHeight - element.clientHeight <= 1,
    );
  }

  /** Makes the cascade find `summary` and answers its save, so no override leaks. */
  async stubSummaryFound(summary: string): Promise<void> {
    await this.page.route(summaryUrls.sources, (route) =>
      route.fulfill({ json: ["OpenLibrary"] }),
    );
    await this.page.route(summaryUrls.fetch, (route) =>
      route.fulfill({ json: summary }),
    );
    // The save answers with the book as it now reads, so the stub reads the
    // book and lays the saved description over it.
    await this.page.route(overridesUrls.save, async (route) => {
      const bookUrl = route
        .request()
        .url()
        .replace(/\/overrides$/, "");
      const book = await (
        await route.fetch({ url: bookUrl, method: "GET" })
      ).json();
      const { description } = route.request().postDataJSON();
      await route.fulfill({ json: { ...book, description } });
    });
  }
}

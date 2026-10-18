import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** The full results for a query at `/search/:query`, in sections by kind. */
export class SearchResultsPage extends BasePage {
  protected readonly urlPattern = /\/search\/[^/]+$/;

  readonly topNav: TopNavComponent;

  readonly heading: Locator;
  readonly resultCountText: Locator;
  readonly bookRows: Locator;
  readonly highlightedTermText: Locator;
  readonly jumpRailHeading: Locator;
  readonly railBooksLink: Locator;
  readonly showAllBooksButton: Locator;
  readonly sectionErrorMessage: Locator;
  readonly relevanceSortButton: Locator;
  readonly tableViewButton: Locator;
  readonly gridViewButton: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.heading = page.getByRole("heading", { level: 1 });
    this.resultCountText = page.getByTestId("search-result-count");
    this.bookRows = page.getByTestId("search-book-row");
    this.highlightedTermText = page.locator(".search-hit").first();
    this.jumpRailHeading = page.getByText("On this page");
    this.railBooksLink = page
      .getByRole("complementary")
      .getByRole("link", { name: /^Books/ });
    this.showAllBooksButton = page.getByTestId("search-show-all-results-books");
    this.sectionErrorMessage = page.getByTestId("search-section-error");
    this.relevanceSortButton = page.getByRole("button", {
      name: "Relevance ↓",
    });
    this.tableViewButton = page.getByRole("button", { name: "Table" });
    this.gridViewButton = page.getByRole("button", { name: "Grid" });
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  async goto(query: string): Promise<void> {
    await this.openAndSettle(`/search/${query}`);
  }

  /** Expands or collapses the books section; collapsing needs no fetch. */
  async toggleShowAllBooks(): Promise<void> {
    await this.showAllBooksButton.click();
  }

  /** The hit count the books section's "Show all N" button offers. */
  async showAllBooksCount(): Promise<number> {
    const label = await this.showAllBooksButton.innerText();
    return Number(label.replace(/\D/g, ""));
  }

  /** Checks the page is showing the results for `query`. */
  async assertDisplayedFor(query: string): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`/search/${query}$`));
  }
}

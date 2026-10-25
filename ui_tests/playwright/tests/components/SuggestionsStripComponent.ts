import type { Locator, Page } from "@playwright/test";
import { suggestionsUrls } from "../contracts/suggestions";
import type { SuggestionItem, SuggestionsResponse } from "../data/bookDetail";
import { BaseComponent } from "./BaseComponent";

/** The "Readers also enjoyed" strip: a connect prompt, a pending note, an unavailable note, an empty note or cards. */
export class SuggestionsStripComponent extends BaseComponent {
  readonly root: Locator;
  readonly heading: Locator;
  readonly notConfigured: Locator;
  readonly notConfiguredText: Locator;
  readonly connectLink: Locator;
  readonly pending: Locator;
  readonly pendingText: Locator;
  readonly spinner: Locator;
  readonly unavailable: Locator;
  readonly unavailableText: Locator;
  readonly empty: Locator;
  readonly emptyText: Locator;
  readonly cards: Locator;
  readonly firstCard: Locator;
  readonly lastCard: Locator;
  readonly showMoreButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("suggestions-strip");
    this.heading = page.getByRole("heading", { name: "Suggested for you" });
    this.notConfigured = page.getByTestId("suggestions-not-configured");
    this.notConfiguredText = page.getByText(
      "Add a Hardcover API key to pull read-alikes for this book.",
    );
    this.connectLink = page.getByTestId("suggestions-connect-link");
    this.pending = page.getByTestId("suggestions-pending");
    this.pendingText = page.getByText("Looking for read-alikes via Hardcover…");
    this.spinner = page.getByTestId("suggestions-spinner");
    this.unavailable = page.getByTestId("suggestions-unavailable");
    this.unavailableText = page.getByText(
      "Suggestions are unavailable right now.",
    );
    this.empty = page.getByTestId("suggestions-empty");
    this.emptyText = page.getByText("No read-alikes found for this book yet.");
    this.cards = this.root.getByTestId("suggestion-card");
    this.firstCard = this.cards.first();
    this.lastCard = this.cards.last();
    this.showMoreButton = page.getByTestId("suggestions-show-more");
  }

  async showMore(): Promise<void> {
    await this.showMoreButton.click();
  }

  /** Answers as a server with no Hardcover key. */
  async stubNotConfigured(): Promise<void> {
    await this.stubResponse({ status: "not_configured" });
  }

  /** Answers as a server that has queued the lookup and cached nothing yet. */
  async stubPending(): Promise<void> {
    await this.stubResponse({ status: "pending" });
  }

  /** Answers as a server whose last lookup failed. */
  async stubUnavailable(): Promise<void> {
    await this.stubResponse({ status: "unavailable" });
  }

  /** Answers as a server whose cache holds `items`, none of them for an empty list. */
  async stubReady(items: SuggestionItem[]): Promise<void> {
    await this.stubResponse({ status: "ready", items });
  }

  // The state depends on a server-wide key and a live Hardcover call, so
  // every test answers the call itself.
  private async stubResponse(response: SuggestionsResponse): Promise<void> {
    await this.page.route(suggestionsUrls.fetch, (route) =>
      route.fulfill({ json: response }),
    );
  }
}

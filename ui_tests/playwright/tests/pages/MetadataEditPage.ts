import type { Locator, Page } from "@playwright/test";
import { MetadataFormComponent } from "../components/MetadataFormComponent";
import { MetadataSearchOverlayComponent } from "../components/MetadataSearchOverlayComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { coversUrls } from "../contracts/covers";
import type { EditionAnswers } from "../data/editions";
import { BasePage } from "./BasePage";

/** A book's metadata edit page at `/books/:uuid/edit`. */
export class MetadataEditPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+\/edit$/;

  readonly topNav: TopNavComponent;
  readonly form: MetadataFormComponent;
  readonly searchOverlay: MetadataSearchOverlayComponent;

  readonly pageTitleLabel: Locator;
  readonly breadcrumbHomeLink: Locator;
  readonly revertButton: Locator;
  readonly genresLabel: Locator;
  readonly genresSection: Locator;
  readonly genresInput: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.form = new MetadataFormComponent(page);
    this.searchOverlay = new MetadataSearchOverlayComponent(page);
    // "Edit metadata" also appears in the breadcrumb tail, so find it by test id.
    this.pageTitleLabel = page.getByTestId("me-page-title-label");
    this.breadcrumbHomeLink = page
      .getByRole("navigation", { name: "breadcrumb" })
      .getByRole("link", { name: "Home" });
    this.revertButton = page.getByTestId("revert-overrides");
    this.genresLabel = page.getByText("Genres", { exact: true });
    this.genresSection = page.getByTestId("me-genres-section");
    this.genresInput = this.genresSection.getByTestId("me-genres-input");
  }

  protected get readyLocator(): Locator {
    return this.pageTitleLabel;
  }

  /** The heading over the form, which names the book among other text. */
  bookHeading(title: string): Locator {
    return this.page.getByRole("heading", { level: 2 }).getByText(title);
  }

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/books/${bookUuid}/edit`);
  }

  /** Opens the book's edit page with the providers answering `answers`, then searches. */
  async searchEditions(
    bookUuid: string,
    answers: EditionAnswers,
  ): Promise<void> {
    await this.searchOverlay.stubEditionLookup(answers);
    await this.goto(bookUuid);
    await this.searchOverlay.openAndSearch();
  }

  /** Checks the page is editing the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`/books/${bookUuid}/edit$`));
  }

  /** Clicks Revert to scanned values; a test that asserts the write wraps it. */
  async revertOverrides(): Promise<void> {
    await this.revertButton.click();
  }

  /** Adds a genre chip with Enter, which clears the input as the chip lands. */
  async addGenre(genre: string): Promise<void> {
    await this.genresInput.fill(genre);
    await this.genresInput.press("Enter");
  }

  /** Answers a cover-from-URL write with the book as the server would return it. */
  async stubCoverFromUrl(book: Record<string, unknown>): Promise<void> {
    // The real handler flips both flags, and the sidebar's card reads `has_override`.
    await this.page.route(coversUrls.fromUrl, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            json: { ...book, has_cover_override: true, has_override: true },
          })
        : route.continue(),
    );
  }

  /** Refuses every cover-from-URL write, as the server does a disallowed host. */
  async stubCoverFromUrlRefused(): Promise<void> {
    await this.page.route(coversUrls.fromUrl, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 400,
            contentType: "text/plain",
            body: "host is not an allowed source: evil.example",
          })
        : route.continue(),
    );
  }
}

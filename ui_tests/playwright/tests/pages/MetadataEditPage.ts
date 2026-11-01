import type { Locator, Page } from "@playwright/test";
import { MetadataFetchComponent } from "../components/MetadataFetchComponent";
import { MetadataFormComponent } from "../components/MetadataFormComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { coversUrls } from "../contracts/covers";
import type { EditionAnswers } from "../data/editions";
import { recordRequests } from "../utils/api";
import { BasePage } from "./BasePage";

/** A book's metadata editor at `/books/:uuid/edit`: a sheet over the book page. */
export class MetadataEditPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+\/edit$/;

  readonly topNav: TopNavComponent;
  readonly form: MetadataFormComponent;
  readonly fetchView: MetadataFetchComponent;

  readonly sheet: Locator;
  readonly sheetTitle: Locator;
  readonly closeButton: Locator;
  readonly revertButton: Locator;
  readonly revertDialog: Locator;
  readonly revertError: Locator;
  private readonly confirmRevertButton: Locator;
  private readonly cancelRevertButton: Locator;
  private readonly dontSaveButton: Locator;
  readonly genresLabel: Locator;
  readonly genresSection: Locator;
  readonly genresInput: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.form = new MetadataFormComponent(page);
    this.fetchView = new MetadataFetchComponent(page);
    this.sheet = page.getByTestId("edit-sheet");
    // The head names the book as the form holds it, so it follows the Title field.
    this.sheetTitle = page.getByTestId("es-title");
    this.closeButton = page.getByTestId("es-close");
    this.revertButton = page.getByTestId("revert-overrides");
    this.revertDialog = page.getByTestId("revert-overrides-modal");
    this.revertError = this.revertDialog.getByRole("alert");
    this.confirmRevertButton = page.getByTestId(
      "revert-overrides-modal-confirm",
    );
    this.cancelRevertButton = page.getByTestId("revert-overrides-modal-cancel");
    // The leave bar's answer: "Don’t save", with a typographic apostrophe.
    this.dontSaveButton = page.getByRole("button", { name: /^Don.t save$/ });
    this.genresSection = page.getByTestId("me-genres-section");
    // The editor opens over the book page, whose Overview has its own "Genres" term.
    this.genresLabel = this.genresSection.getByText("Genres", { exact: true });
    this.genresInput = this.genresSection.getByTestId("me-genres-input");
  }

  protected get readyLocator(): Locator {
    return this.sheetTitle;
  }

  /** The sheet's head, when it names the book `title`. */
  bookHeading(title: string): Locator {
    return this.sheetTitle.filter({ hasText: title });
  }

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/books/${bookUuid}/edit`);
  }

  /** Opens the book's editor with the providers answering `answers`, then fetches. */
  async searchEditions(
    bookUuid: string,
    answers: EditionAnswers,
  ): Promise<void> {
    await this.fetchView.stubEditionLookup(answers);
    await this.goto(bookUuid);
    await this.fetchView.openAndSearch();
  }

  /** Checks the page is editing the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`/books/${bookUuid}/edit$`));
  }

  /** Closes the sheet with its ×, which asks first only when edits are unsaved. */
  async close(): Promise<void> {
    await this.closeButton.click();
  }

  /** Answers the leave bar's question by dropping the unsaved edits. */
  async leaveWithoutSaving(): Promise<void> {
    await this.dontSaveButton.click();
  }

  /** Asks to revert, then confirms; a test that asserts the write wraps it. */
  async revertOverrides(): Promise<void> {
    await this.revertButton.click();
    await this.confirmRevertButton.click();
  }

  async cancelRevert(): Promise<void> {
    await this.cancelRevertButton.click();
  }

  /** Adds a genre chip with Enter, which clears the input as the chip lands. */
  async addGenre(genre: string): Promise<void> {
    await this.genresInput.fill(genre);
    await this.genresInput.press("Enter");
  }

  /** Listens for writes to the book's cover: an upload or a fetch from a URL. */
  recordCoverWrites(): string[] {
    return recordRequests(this.page, /\/api\/ebooks\/[^/]+\/cover/, "POST");
  }

  /** Answers a cover-from-URL write with the book as the server would return it. */
  async stubCoverFromUrl(book: Record<string, unknown>): Promise<void> {
    // The real handler flips both flags, and the cover card reads `has_cover_override`.
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

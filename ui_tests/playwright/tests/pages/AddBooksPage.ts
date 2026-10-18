import type { Locator, Page } from "@playwright/test";
import { MetadataFormComponent } from "../components/MetadataFormComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** What a file input takes: paths, or files built in memory. */
type PickedFiles = Parameters<Locator["setInputFiles"]>[0];

/** The upload page at `/add-books`: one picker, then a review form per pick. */
export class AddBooksPage extends BasePage {
  protected readonly urlPattern = /\/add-books$/;

  readonly topNav: TopNavComponent;
  readonly form: MetadataFormComponent;

  readonly heading: Locator;
  readonly fileInput: Locator;
  readonly formatsHint: Locator;
  readonly ebookTypeToggle: Locator;
  readonly audiobookTypeToggle: Locator;
  readonly statusMessage: Locator;
  readonly review: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.form = new MetadataFormComponent(page);
    this.heading = page.getByRole("heading", { name: "Upload a book" });
    this.fileInput = page.getByTestId("add-books-file-input");
    this.formatsHint = page.getByTestId("add-books-formats");
    this.ebookTypeToggle = page.getByTestId("add-books-type-ebook");
    this.audiobookTypeToggle = page.getByTestId("add-books-type-audiobook");
    this.statusMessage = page.getByTestId("add-books-status");
    this.review = page.getByTestId("add-books-review");
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/add-books");
  }

  /** Picks files, which sends the pick to the ingest its extensions name. */
  async pickFiles(files: PickedFiles): Promise<void> {
    await this.fileInput.setInputFiles(files);
  }

  /** Stages a cover for the book, to be saved with it. */
  async stageCover(png: Buffer): Promise<void> {
    await this.form.coverUploadInput.setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: png,
    });
  }

  async removeStagedCover(): Promise<void> {
    await this.form.removeCoverOverrideButton.click();
  }

  /** Drops the review form and returns to the picker. */
  async startOver(): Promise<void> {
    await this.form.discardButton.click();
  }

  /** Listens for requests that would create something: a commit or a cover. */
  recordCommitRequests(): string[] {
    const urls: string[] = [];
    this.page.on("request", (request) => {
      const url = request.url();
      const isUpload =
        url.includes("/api/uploads/") && !url.includes("/inspect");
      if (isUpload || /\/api\/ebooks\/[^/]+\/cover/.test(url)) {
        urls.push(url);
      }
    });
    return urls;
  }

  /** Listens for any request to the upload routes, inspect included. */
  recordUploadRequests(): string[] {
    const urls: string[] = [];
    this.page.on("request", (request) => {
      if (request.url().includes("/api/uploads/")) urls.push(request.url());
    });
    return urls;
  }
}

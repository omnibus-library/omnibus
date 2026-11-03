import type { Locator, Page } from "@playwright/test";
import { MetadataFormComponent } from "../components/MetadataFormComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** What a file input takes: paths, or files built in memory. */
type PickedFiles = Parameters<Locator["setInputFiles"]>[0];

/**
 * The Add a book sheet the top nav's Add books opens over the library: one
 * picker, then a review in the edit sheet's form per pick.
 */
export class AddBooksPage extends BasePage {
  protected readonly urlPattern = /\/$/;

  readonly topNav: TopNavComponent;
  readonly form: MetadataFormComponent;

  readonly sheet: Locator;
  readonly heading: Locator;
  readonly fileInput: Locator;
  readonly formatsHint: Locator;
  /** Why a pick was refused or could not be read. */
  readonly statusMessage: Locator;
  /** The review's tabs, which show once a pick has been read. */
  readonly review: Locator;
  readonly addButton: Locator;
  private readonly chooseAnotherFileButton: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.form = new MetadataFormComponent(page);
    this.sheet = page.getByRole("dialog", { name: "Add a book" });
    this.heading = this.sheet.getByRole("heading", { name: "Add a book" });
    this.fileInput = this.sheet.getByLabel("Choose files");
    this.formatsHint = this.sheet.getByTestId("add-book-formats");
    this.statusMessage = this.sheet.getByRole("alert");
    this.review = this.sheet.getByRole("tablist", { name: "Book information" });
    this.addButton = this.sheet.getByRole("button", { name: "Add to library" });
    this.chooseAnotherFileButton = this.sheet.getByRole("button", {
      name: "Choose another file",
    });
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  /** Opens the library, then the sheet from the top nav's Add books. */
  async goto(): Promise<void> {
    await this.page.goto("/");
    await this.topNav.addBooksButton.click();
    await this.heading.waitFor();
    await this.page.waitForLoadState("networkidle");
  }

  /** Picks files, which sends the pick to the ingest its extensions name. */
  async pickFiles(files: PickedFiles): Promise<void> {
    await this.fileInput.setInputFiles(files);
  }

  /** Stages a cover for the book, to be saved with it. */
  async stageCover(png: Buffer): Promise<void> {
    await this.form.openArtwork();
    await this.form.coverUploadInput.setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: png,
    });
  }

  /** Drops the pick and goes back to the picker; with no edits it does not ask. */
  async chooseAnotherFile(): Promise<void> {
    await this.chooseAnotherFileButton.click();
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

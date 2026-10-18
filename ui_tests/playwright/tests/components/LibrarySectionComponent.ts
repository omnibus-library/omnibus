import type { Locator, Page } from "@playwright/test";
import { settingsUrls } from "../contracts/settings";
import type { LibrarySettings } from "../data/settings";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";

/** Settings → Library Location: scan paths, rescan interval and bulk jobs. */
export class LibrarySectionComponent extends BaseComponent {
  readonly ebookPathField: Locator;
  readonly audiobookPathField: Locator;
  readonly scanIntervalField: Locator;
  readonly saveButton: Locator;
  readonly scanButton: Locator;
  readonly bakeEpubOverridesButton: Locator;
  readonly status: Locator;
  readonly ebookSummary: Locator;
  readonly audiobookSummary: Locator;

  constructor(page: Page) {
    super(page);
    this.ebookPathField = page.getByLabel("Ebook Library Path");
    this.audiobookPathField = page.getByLabel("Audiobook Library Path");
    this.scanIntervalField = page.getByLabel(
      "Automatic Rescan Interval (hours)",
    );
    // The metadata cards have Save buttons of their own, so scope to this form.
    this.saveButton = page
      .locator("#settings-form")
      .getByRole("button", { name: "Save" });
    this.scanButton = page.getByTestId("scan-library");
    this.bakeEpubOverridesButton = page.getByTestId("rewrite-all-epubs");
    // The worker indicator is a role=status too, so find the form's by testid.
    this.status = page.getByTestId("settings-status");
    this.ebookSummary = page.getByTestId("ebook-library-summary");
    this.audiobookSummary = page.getByTestId("audiobook-library-summary");
  }

  /** Fills every field; no interval clears it, so a saved one can't leak in. */
  async fillForm(library: LibrarySettings): Promise<void> {
    await this.ebookPathField.fill(library.ebook_library_path);
    await this.audiobookPathField.fill(library.audiobook_library_path);
    await this.scanIntervalField.fill(
      library.scan_interval_hours?.toString() ?? "",
    );
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async startScan(): Promise<void> {
    await this.scanButton.click();
  }

  async bakeEpubOverrides(): Promise<void> {
    await this.bakeEpubOverridesButton.click();
  }

  /** Answers a save with the server-side floor on the rescan interval. */
  async stubIntervalRejected(): Promise<void> {
    await this.page.route(settingsUrls.save, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 422,
            contentType: "text/plain",
            body: "scan_interval_hours must be at least 1 (omit to disable)",
          })
        : route.continue(),
    );
  }

  /** Answers the bulk EPUB bake as queued, so no book file is rewritten. */
  async stubBakeQueued(): Promise<void> {
    await this.page.route(settingsUrls.rewriteAllEpubs, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "null",
          })
        : route.continue(),
    );
  }

  /** Checks the form reports its save as done. */
  async assertSaved(): Promise<void> {
    await expect(this.status).toHaveText("Settings saved.");
    await expect(this.status).toHaveClass(/success/);
  }

  /** Checks the form reports its save as failed. */
  async assertSaveFailed(): Promise<void> {
    await expect(this.status).toHaveText("Failed to save settings.");
    await expect(this.status).toHaveClass(/error/);
  }
}

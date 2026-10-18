import type { Locator, Page } from "@playwright/test";
import { settingsUrls } from "../contracts/settings";
import type { LibrarySettings } from "../data/settings";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";

/** Administration › Sources: the scan paths and the rescan interval. */
export class LibrarySectionComponent extends BaseComponent {
  readonly ebookPathField: Locator;
  readonly audiobookPathField: Locator;
  readonly scanIntervalField: Locator;
  readonly saveButton: Locator;
  readonly retryButton: Locator;
  readonly status: Locator;
  readonly ebookSummary: Locator;
  readonly audiobookSummary: Locator;

  constructor(page: Page) {
    super(page);
    this.ebookPathField = page.getByLabel("Ebook library path");
    this.audiobookPathField = page.getByLabel("Audiobook library path");
    this.scanIntervalField = page.getByLabel(
      "Automatic rescan interval (hours)",
    );
    this.saveButton = page.getByRole("button", {
      name: "Save library settings",
    });
    this.retryButton = page.getByTestId("library-retry");
    this.status = page.getByTestId("settings-status");
    this.ebookSummary = page.getByTestId("ebook-library-summary");
    this.audiobookSummary = page.getByTestId("audiobook-library-summary");
  }

  async fillEbookPath(path: string): Promise<void> {
    await this.ebookPathField.fill(path);
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

  /** Fails the read of the saved settings, which the form fills itself from. */
  async stubSettingsUnreadable(): Promise<void> {
    await this.page.route(settingsUrls.save, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 500,
            contentType: "text/plain",
            body: "forced failure",
          })
        : route.continue(),
    );
  }

  /** Checks the form reports its save as done. */
  async assertSaved(): Promise<void> {
    await expect(this.status).toHaveText("Library settings saved.");
    await expect(this.status).toHaveClass(/success/);
  }

  /** Checks the form reports its save as failed. */
  async assertSaveFailed(): Promise<void> {
    await expect(this.status).toContainText(
      "Couldn’t save the library settings",
    );
    await expect(this.status).toHaveClass(/error/);
  }
}

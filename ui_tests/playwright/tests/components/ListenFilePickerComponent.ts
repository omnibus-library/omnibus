import type { Locator, Page, Request } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The file picker on Start listening, which a book with two audio files has. */
export class ListenFilePickerComponent extends BaseComponent {
  readonly trigger: Locator;
  readonly panel: Locator;
  readonly heading: Locator;
  readonly fileLinks: Locator;

  constructor(page: Page) {
    super(page);
    // Asserted absent, so found by test id, not by label.
    this.trigger = page.getByTestId("listen-file-picker-trigger");
    this.panel = page.getByTestId("listen-file-picker-panel");
    this.heading = page.getByTestId("listen-file-picker-heading");
    this.fileLinks = this.panel.getByRole("link");
  }

  /** The link to one file, found by the id the server gave it. */
  fileLink(fileId: number): Locator {
    return this.panel.getByTestId(`listen-file-picker-item-${fileId}`);
  }

  async open(): Promise<void> {
    await this.trigger.click();
  }

  /** Picks the file and returns the manifest request for that file. */
  async pick(fileId: number): Promise<Request> {
    const manifest = this.page.waitForRequest(
      new RegExp(`/api/audiobooks/[^/]+/manifest\\?file_id=${fileId}$`),
    );
    await this.fileLink(fileId).click();
    return manifest;
  }
}

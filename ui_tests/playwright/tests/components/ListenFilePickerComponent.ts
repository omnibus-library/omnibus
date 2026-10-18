import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The menu beside Start listening that picks which of several audio files to play. */
export class ListenFilePickerComponent extends BaseComponent {
  readonly trigger: Locator;
  readonly panel: Locator;
  readonly panelHeading: Locator;
  readonly fileLinks: Locator;
  readonly firstFileLink: Locator;

  constructor(page: Page) {
    super(page);
    this.trigger = page.getByTestId("listen-file-picker-trigger");
    this.panel = page.getByTestId("listen-file-picker-panel");
    this.panelHeading = page.getByTestId("listen-file-picker-heading");
    this.fileLinks = this.panel.getByRole("link");
    this.firstFileLink = this.fileLinks.first();
  }

  async open(): Promise<void> {
    await this.trigger.click();
  }

  /** Opens the menu and picks the file whose row reads `label`. */
  async choosePart(label: string): Promise<void> {
    await this.open();
    await this.fileLinks.filter({ hasText: label }).click();
  }

  /** Records the manifest URL of every part the player fetches from now on. */
  recordManifestRequests(bookUuid: string): string[] {
    const urls: string[] = [];
    this.page.on("request", (request) => {
      if (
        request.url().includes(`/api/audiobooks/${bookUuid}/manifest?file_id=`)
      ) {
        urls.push(request.url());
      }
    });
    return urls;
  }
}

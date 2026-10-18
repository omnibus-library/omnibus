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

  /** Opens the menu, picks the file at `index`, and returns the manifest URL it fetches. */
  async choosePart(bookUuid: string, index: number): Promise<string> {
    await this.open();
    await this.panel.waitFor();
    const manifest = this.page.waitForRequest((request) =>
      request.url().includes(`/api/audiobooks/${bookUuid}/manifest?file_id=`),
    );
    await this.fileLinks.nth(index).click();
    return (await manifest).url();
  }
}

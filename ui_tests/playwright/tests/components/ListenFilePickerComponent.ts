import type { Locator, Page } from "@playwright/test";
import { audiobookUrls } from "../contracts/audiobooks";
import { BaseComponent } from "./BaseComponent";

/** The file picker on Start listening, which a book with two audio files has. */
export class ListenFilePickerComponent extends BaseComponent {
  readonly triggerButton: Locator;
  readonly panel: Locator;
  readonly heading: Locator;
  readonly fileLinks: Locator;

  constructor(page: Page) {
    super(page);
    this.triggerButton = page.getByTestId("listen-file-picker-trigger");
    this.panel = page.getByTestId("listen-file-picker-panel");
    this.heading = page.getByTestId("listen-file-picker-heading");
    this.fileLinks = this.panel.getByRole("link");
  }

  /** The link to the file whose row reads `label`, such as `Part 1`. */
  fileLink(label: string): Locator {
    return this.fileLinks.filter({ hasText: label });
  }

  async open(): Promise<void> {
    await this.triggerButton.click();
  }

  async pick(label: string): Promise<void> {
    await this.fileLink(label).click();
  }

  /** Records the URL of every manifest the player requests from now on. */
  recordManifestRequests(): string[] {
    const urls: string[] = [];
    this.page.on("request", (request) => {
      if (audiobookUrls.manifest.test(request.url())) urls.push(request.url());
    });
    return urls;
  }
}

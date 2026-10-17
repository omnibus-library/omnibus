import type { Locator, Page, Request } from "@playwright/test";
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

  /** The link to one file, found by the id the server gave it. */
  fileLink(fileId: number): Locator {
    return this.panel.getByTestId(`listen-file-picker-item-${fileId}`);
  }

  async open(): Promise<void> {
    await this.triggerButton.click();
  }

  /**
   * Waits for the player's manifest request; call it before `pick`. Bounded,
   * so a pick that boots nothing fails in 10 s, not the slowed test's 180 s.
   */
  waitForManifest(): Promise<Request> {
    return this.page.waitForRequest(audiobookUrls.manifest, {
      timeout: 10_000,
    });
  }

  async pick(fileId: number): Promise<void> {
    await this.fileLink(fileId).click();
  }
}

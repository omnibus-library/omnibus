import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The hero's Export menu, which gathers the per-device actions in one panel. */
export class BookExportComponent extends BaseComponent {
  readonly trigger: Locator;
  readonly panel: Locator;
  readonly scrim: Locator;
  readonly downloadEpubLink: Locator;
  readonly downloadAudioLink: Locator;
  readonly sendToKindleButton: Locator;
  readonly sendToKoboButton: Locator;

  constructor(page: Page) {
    super(page);
    this.trigger = page.getByTestId("hero-export");
    this.panel = page.getByTestId("hero-export-panel");
    this.scrim = page.getByTestId("hero-export-scrim");
    this.downloadEpubLink = this.panel.getByTestId("export-download-epub");
    this.downloadAudioLink = this.panel.getByTestId("export-download-audio");
    this.sendToKindleButton = this.panel.getByTestId("hero-send-kindle");
    this.sendToKoboButton = this.panel.getByTestId("hero-send-kobo");
  }

  async open(): Promise<void> {
    await this.trigger.click();
  }

  // The scrim fills the viewport, so click clear of the panel and below the
  // sticky topbar, which sits above the scrim and takes a corner click.
  async closeByClickingScrim(): Promise<void> {
    await this.scrim.click({ position: { x: 10, y: 300 } });
  }
}

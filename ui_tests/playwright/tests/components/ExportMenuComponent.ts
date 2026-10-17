import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The hero's Export dropdown: its trigger, panel and click-away scrim. */
export class ExportMenuComponent extends BaseComponent {
  readonly triggerButton: Locator;
  readonly panel: Locator;
  readonly scrim: Locator;
  readonly downloadEpubLink: Locator;
  readonly downloadAudiobookLink: Locator;
  readonly sendToKindleButton: Locator;
  readonly sendToKoboButton: Locator;

  constructor(page: Page) {
    super(page);
    this.triggerButton = page.getByRole("button", {
      name: "Export",
      exact: true,
    });
    this.panel = page.getByTestId("hero-export-panel");
    // The scrim has no role or label, so it is found by test id.
    this.scrim = page.getByTestId("hero-export-scrim");
    this.downloadEpubLink = this.panel.getByRole("link", {
      name: "Download EPUB",
    });
    this.downloadAudiobookLink = this.panel.getByTestId(
      "export-download-audio",
    );
    // The send buttons relabel to "Sending…" while busy, so they are found by
    // test id.
    this.sendToKindleButton = this.panel.getByTestId("hero-send-kindle");
    this.sendToKoboButton = this.panel.getByTestId("hero-send-kobo");
  }

  async open(): Promise<void> {
    await this.triggerButton.click();
  }

  // The scrim fills the viewport, so click clear of the panel on its left and
  // below the sticky topbar, which sits above the scrim and takes corner clicks.
  async closeByClickingOutside(): Promise<void> {
    await this.scrim.click({ position: { x: 10, y: 300 } });
  }
}

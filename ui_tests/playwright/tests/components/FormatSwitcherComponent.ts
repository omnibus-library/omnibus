import type { Locator, Page } from "@playwright/test";
import { kindleUrls } from "../contracts/kindle";
import { BaseComponent } from "./BaseComponent";

/** The book page's per-format rows, each with its own read and send actions. */
export class FormatSwitcherComponent extends BaseComponent {
  readonly root: Locator;
  readonly epubRow: Locator;
  readonly badges: Locator;
  readonly epubBadge: Locator;
  readonly kindleButton: Locator;
  readonly koboButton: Locator;
  readonly listenAction: Locator;
  readonly kindleStatus: Locator;
  readonly dismissKindleStatusButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("format-switcher");
    this.epubRow = this.root.getByTestId("format-row-epub");
    this.badges = page.getByTestId("format-badge");
    this.epubBadge = this.epubRow.getByTestId("format-badge");
    this.kindleButton = this.epubRow.getByTestId("action-kindle");
    this.koboButton = this.epubRow.getByTestId("action-kobo");
    this.listenAction = this.root.getByTestId("action-listen");
    this.kindleStatus = page.getByTestId("kindle-send-status");
    this.dismissKindleStatusButton = page.getByTestId("kindle-toast-dismiss");
  }

  /** The copies-list row for a format, such as `MP3`. */
  row(format: string): Locator {
    return this.page.locator(`[data-format="${format}"]`).first();
  }

  /** Opens the audiobook player through the Listen action. */
  async listen(): Promise<void> {
    await this.listenAction.click();
  }

  async sendToKindle(): Promise<void> {
    await this.kindleButton.click();
  }

  async dismissKindleStatus(): Promise<void> {
    await this.dismissKindleStatusButton.click();
  }

  /** Clicks Send to Kobo, which the browser answers with a download. */
  async downloadForKobo(): Promise<void> {
    await this.koboButton.click();
  }

  /** Records the file name of every download the page starts from now on. */
  recordDownloads(): string[] {
    const names: string[] = [];
    this.page.on("download", (download) =>
      names.push(download.suggestedFilename()),
    );
    return names;
  }

  /** Hides the directory picker so Send to Kobo downloads; call before opening the book. */
  async stubNoDirectoryPicker(): Promise<void> {
    await this.page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: undefined,
      });
    });
  }

  /** Makes the next Kindle delivery succeed, with no relay behind it. */
  async stubKindleDelivered(): Promise<void> {
    await this.stubKindleDelivery({ status: "sent" });
  }

  /** Makes the next Kindle delivery fail in the worker, after it was queued. */
  async stubKindleDeliveryFailed(message: string): Promise<void> {
    await this.stubKindleDelivery({ status: "failed", message });
  }

  private async stubKindleDelivery(status: unknown): Promise<void> {
    await this.page.route(kindleUrls.send, (route) =>
      route.fulfill({ json: 1 }),
    );
    await this.page.route(kindleUrls.sendStatus, (route) =>
      route.fulfill({ json: status }),
    );
  }
}

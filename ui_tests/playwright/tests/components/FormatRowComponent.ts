import type { Download, Locator, Page } from "@playwright/test";
import { kindleUrls } from "../contracts/kindle";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** One format's row in the files stop: its read and send actions. */
export class FormatRowComponent extends BaseComponent {
  readonly badge: Locator;
  readonly readLink: Locator;
  readonly kindleButton: Locator;
  readonly koboButton: Locator;
  readonly kindleSendStatus: Locator;
  readonly dismissKindleToastButton: Locator;

  constructor(
    page: Page,
    readonly root: Locator,
  ) {
    super(page);
    this.badge = root.getByTestId("format-badge");
    this.readLink = root.getByRole("link", { name: "Read", exact: true });
    // The send buttons relabel to "Sending…" while busy, so they are found by
    // test id.
    this.kindleButton = root.getByTestId("action-kindle");
    this.koboButton = root.getByTestId("action-kobo");
    this.kindleSendStatus = root.getByTestId("kindle-send-status");
    this.dismissKindleToastButton = root.getByRole("button", {
      name: "Dismiss",
    });
  }

  /** Clicks Send to Kindle and waits for the send request to answer. */
  async sendToKindle(): Promise<void> {
    const sent = this.page.waitForResponse(isPostTo(kindleUrls.send));
    await this.kindleButton.click();
    await sent;
  }

  /** Waits for the file Send to Kobo downloads; call it before `sendToKobo`. */
  waitForKoboDownload(): Promise<Download> {
    return this.page.waitForEvent("download");
  }

  async sendToKobo(): Promise<void> {
    await this.koboButton.click();
  }

  async dismissKindleToast(): Promise<void> {
    await this.dismissKindleToastButton.click();
  }
}

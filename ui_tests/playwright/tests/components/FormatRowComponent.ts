import type { Locator, Page } from "@playwright/test";
import { kindleUrls } from "../contracts/kindle";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** One format's row in the files stop: its read, listen and send actions. */
export class FormatRowComponent extends BaseComponent {
  readonly badge: Locator;
  readonly readLink: Locator;
  readonly listenLink: Locator;
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
    this.listenLink = root.getByRole("link", { name: "Listen", exact: true });
    // The send buttons relabel to "Sending…" while busy, so they are found by
    // test id.
    this.kindleButton = root.getByTestId("action-kindle");
    this.koboButton = root.getByTestId("action-kobo");
    this.kindleSendStatus = root.getByTestId("kindle-send-status");
    this.dismissKindleToastButton = root.getByRole("button", {
      name: "Dismiss",
    });
  }

  async read(): Promise<void> {
    await this.readLink.click();
  }

  async listen(): Promise<void> {
    await this.listenLink.click();
  }

  /** Clicks Send to Kindle and waits for the send request to answer. */
  async sendToKindle(): Promise<void> {
    const sent = this.page.waitForResponse(isPostTo(kindleUrls.send));
    await this.kindleButton.click();
    await sent;
  }

  /** Clicks Send to Kobo, which the browser answers with a download. */
  async sendToKobo(): Promise<void> {
    await this.koboButton.click();
  }

  async dismissKindleToast(): Promise<void> {
    await this.dismissKindleToastButton.click();
  }
}

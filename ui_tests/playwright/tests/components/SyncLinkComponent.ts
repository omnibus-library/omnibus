import type { Locator, Page } from "@playwright/test";
import { crossFormatUrls } from "../contracts/crossFormat";
import { BaseComponent } from "./BaseComponent";

/** The book page's cross-format row: whether the formats are linked, the follow switch, and the progress ruler. */
export class SyncLinkComponent extends BaseComponent {
  readonly root: Locator;
  readonly linkFormatsButton: Locator;
  readonly manageButton: Locator;
  readonly linkedSummary: Locator;
  readonly unlinkedSummary: Locator;
  // Named by its aria-label, which holds while the visible text flips.
  readonly followSwitch: Locator;
  readonly followError: Locator;
  readonly progressRuler: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("sync-link-row");
    this.linkFormatsButton = page.getByTestId("sync-link-open");
    this.manageButton = page.getByTestId("sync-link-manage");
    this.linkedSummary = this.root.getByText("one spot, both formats");
    this.unlinkedSummary = this.root.getByText("positions aren't synced", {
      exact: false,
    });
    this.followSwitch = page.getByRole("switch", {
      name: "Follow the other format",
    });
    this.followError = page.getByTestId("sync-follow-error");
    this.progressRuler = page.getByTestId("bdmq-ruler");
  }

  async openAlignment(): Promise<void> {
    await this.linkFormatsButton.click();
  }

  async manageAlignment(): Promise<void> {
    await this.manageButton.click();
  }

  async toggleFollow(): Promise<void> {
    await this.followSwitch.click();
  }

  /** Fails the alignment re-read that follows a flip, which keeps the write itself intact. */
  async failAlignmentReads(): Promise<void> {
    await this.page.route(crossFormatUrls.alignment, (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
  }

  async restoreAlignmentReads(): Promise<void> {
    await this.page.unroute(crossFormatUrls.alignment);
  }
}

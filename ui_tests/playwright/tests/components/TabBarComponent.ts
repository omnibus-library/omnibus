import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/**
 * The phone's bottom tab bar and its raised centre action. At desktop width
 * the nav shows the Check in and Add books buttons in its place.
 */
export class TabBarComponent extends BaseComponent {
  readonly centerActionButton: Locator;

  constructor(page: Page) {
    super(page);
    this.centerActionButton = page.getByTestId("tabbar-scan");
  }

  async openAddBooksSheet(): Promise<void> {
    await this.centerActionButton.click();
  }

  async widenToDesktop(): Promise<void> {
    await this.page.setViewportSize({ width: 1280, height: 800 });
  }
}

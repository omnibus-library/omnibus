import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The audio player docked along the bottom of the page while a book plays. */
export class MiniDockComponent extends BaseComponent {
  readonly root: Locator;
  readonly titleLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("mini-dock");
    this.titleLabel = this.root.getByTestId("mini-dock-title");
  }
}

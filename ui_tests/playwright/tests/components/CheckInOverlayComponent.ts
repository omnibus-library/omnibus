import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { CheckInFlowComponent } from "./CheckInFlowComponent";

/** The check-in flow in a dialog over whichever page the reader is on. */
export class CheckInOverlayComponent extends CheckInFlowComponent {
  readonly scrim: Locator;
  readonly flowCard: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    super(page, page.getByRole("dialog", { name: "Check in a book" }));
    this.scrim = page.getByTestId("check-in-overlay-scrim");
    this.flowCard = page.getByTestId("check-in");
    this.closeButton = this.root.getByRole("button", {
      name: "Close",
      exact: true,
    });
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }

  async closeByClickingOutside(): Promise<void> {
    // The top-left corner is scrim, well outside the centred card.
    await this.scrim.click({ position: { x: 8, y: 8 } });
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  /** The overlay is gone and left nothing of itself on the page. */
  async assertDismissed(): Promise<void> {
    await expect(this.scrim).toHaveCount(0);
    await expect(this.root).toHaveCount(0);
    await expect(this.flowCard).toHaveCount(0);
  }
}

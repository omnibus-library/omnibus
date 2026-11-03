import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { CheckInFlowComponent } from "./CheckInFlowComponent";

/** The check-in flow in a dialog over the library, which stays mounted beneath it. */
export class CheckInOverlayComponent extends CheckInFlowComponent {
  /** The dialog is its own backdrop: a click on it outside the card closes it. */
  readonly scrim: Locator;
  readonly flowCard: Locator;
  readonly closeButton: Locator;
  /** Every control that would close the dialog, so a spec can show there is one. */
  readonly closeControls: Locator;

  constructor(page: Page) {
    super(page, page.getByRole("dialog", { name: "Check in a book" }));
    this.scrim = this.root;
    this.flowCard = page.getByTestId("check-in");
    this.closeButton = this.root.getByRole("button", {
      name: "Cancel check-in",
    });
    this.closeControls = this.root.getByRole("button", {
      name: /close|cancel/i,
    });
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }

  async closeByClickingOutside(): Promise<void> {
    // The top-left corner is backdrop, well outside the centered card.
    await this.scrim.click({ position: { x: 8, y: 8 } });
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  /** Checks the dialog and the flow card are both gone. */
  async assertDismissed(): Promise<void> {
    await expect(this.root).toHaveCount(0);
    await expect(this.flowCard).toHaveCount(0);
  }
}

import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";

/** The "Add to shelf" picker, opened from the book page or the bulk edit bar. */
export class ShelfPickerComponent extends BaseComponent {
  readonly root: Locator;
  readonly dialog: Locator;
  readonly closeButton: Locator;
  readonly errorMessage: Locator;
  readonly hint: Locator;
  readonly automaticShelves: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("shelf-picker");
    this.dialog = this.root.getByRole("dialog");
    this.closeButton = page.getByTestId("shelf-picker-close");
    this.errorMessage = page.getByTestId("shelf-picker-error");
    this.hint = page.getByTestId("shelf-picker-hint");
    this.automaticShelves = page.getByTestId("shelf-picker-automatic");
  }

  heading(name: string): Locator {
    return this.root.getByRole("heading", { name });
  }

  /** A hand-picked shelf's tile on the book page, a checkbox (see 04a). */
  shelf(name: string): Locator {
    return this.root.getByRole("checkbox", { name, exact: true });
  }

  /** A hand-picked shelf's tile in the bulk bar's picker, a plain button. */
  shelfButton(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  /** The inert tile of a smart shelf, which its rules fill. */
  automaticShelf(shelfId: number): Locator {
    return this.automaticShelves.getByTestId(`shelf-picker-auto-${shelfId}`);
  }

  /** Files the book on a hand-picked shelf, or takes it off. */
  async toggle(name: string): Promise<void> {
    await this.shelf(name).click();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }

  async dismissWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  /** Clicks the bottom edge: the top strip is the sticky nav, over the scrim. */
  async dismissByBackdrop(): Promise<void> {
    const { width, height } = this.viewport();
    await this.root.click({ position: { x: width / 2, y: height - 4 } });
  }

  /** Whether the overlay is as wide as the window, as a fixed overlay is. */
  async spansWindow(): Promise<boolean> {
    const box = await this.root.boundingBox();
    return box?.width === this.viewport().width;
  }

  /** Checks the shelf's name wraps inside its tile, not spilling or cut short. */
  async assertShelfNameFits(name: string): Promise<void> {
    const label = this.shelf(name).getByText(name, { exact: true });
    await expect
      .poll(() => label.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThanOrEqual(0);
    // A line is ~17px; one pixel is the rounding of fractional line heights.
    await expect
      .poll(() => label.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(1);
  }

  private viewport(): { width: number; height: number } {
    const size = this.page.viewportSize();
    if (!size) throw new Error("the page has no viewport");
    return size;
  }
}

import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The New shelf modal, opened from the landing gallery or the shelves index. */
export class CreateShelfModalComponent extends BaseComponent {
  readonly root: Locator;
  readonly handPickedButton: Locator;
  readonly nameField: Locator;
  readonly createButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("create-shelf-modal");
    this.handPickedButton = this.root.getByRole("button", {
      name: /hand-picked/i,
    });
    this.nameField = this.root.getByTestId("shelf-name-input");
    this.createButton = this.root.getByTestId("shelf-create-submit");
    this.errorMessage = page.getByTestId("shelf-create-error");
  }

  /** Picks the hand-picked kind and names it; no books yet is a valid shelf. */
  async fillHandPickedShelf(name: string): Promise<void> {
    await this.handPickedButton.click();
    await this.nameField.fill(name);
  }

  async create(): Promise<void> {
    await this.createButton.click();
  }

  /** The modal's computed CSS position. */
  cssPosition(): Promise<string> {
    return this.root.evaluate((el) => getComputedStyle(el).position);
  }

  /** The modal's distance from the top of the viewport, if it has a box. */
  async top(): Promise<number | undefined> {
    return (await this.root.boundingBox())?.y;
  }

  /** Scrolls the page underneath the modal with the mouse wheel. */
  async scrollPageUnder(): Promise<void> {
    await this.page.mouse.wheel(0, 600);
  }
}

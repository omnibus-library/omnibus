import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/**
 * The picker's compare screen: one candidate against the book, a row per
 * field. Rows are named by the field's slug, such as `publisher` or `book--`.
 */
export class MetadataCompareComponent extends BaseComponent {
  readonly root: Locator;
  readonly sourceName: Locator;
  readonly hydratingNotice: Locator;
  readonly skeleton: Locator;
  readonly fields: Locator;
  readonly takeAllButton: Locator;
  private readonly toggleUnchangedButton: Locator;
  readonly backButton: Locator;
  private readonly doneButton: Locator;
  readonly coverRow: Locator;
  readonly coverSourceImage: Locator;
  readonly coverNote: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("mes-compare");
    this.sourceName = page.getByTestId("mes-compare-source");
    this.hydratingNotice = page.getByTestId("mes-hydrating");
    this.skeleton = page.getByTestId("mes-compare-skeleton");
    this.fields = page.getByTestId("mes-compare-fields");
    this.takeAllButton = page.getByTestId("mes-take-all");
    this.toggleUnchangedButton = page.getByTestId("mes-show-all");
    this.backButton = page.getByTestId("mes-compare-back");
    this.doneButton = page.getByTestId("mes-done");
    this.coverRow = this.row("cover");
    this.coverSourceImage = page
      .getByTestId("mes-row-cover-source")
      .locator("img");
    this.coverNote = page.getByTestId("mes-row-cover-note");
  }

  row(slug: string): Locator {
    return this.page.getByTestId(`mes-row-${slug}`);
  }

  /** What the candidate offers for the field. */
  rowSource(slug: string): Locator {
    return this.page.getByTestId(`mes-row-${slug}-source`);
  }

  /** What the book has for the field now. */
  rowCurrent(slug: string): Locator {
    return this.page.getByTestId(`mes-row-${slug}-current`);
  }

  /** The arrow that copies the candidate's value into the form. */
  applyButton(slug: string): Locator {
    return this.page.getByTestId(`mes-row-${slug}-apply`);
  }

  /** The control a staged row swaps its arrow for. */
  undoButton(slug: string): Locator {
    return this.page.getByTestId(`mes-row-${slug}-undo`);
  }

  async apply(slug: string): Promise<void> {
    await this.applyButton(slug).click();
  }

  async undo(slug: string): Promise<void> {
    await this.undoButton(slug).click();
  }

  async takeAll(): Promise<void> {
    await this.takeAllButton.click();
  }

  /** Shows or hides the fields the candidate would not change. */
  async toggleUnchanged(): Promise<void> {
    await this.toggleUnchangedButton.click();
  }

  async back(): Promise<void> {
    await this.backButton.click();
  }

  async done(): Promise<void> {
    await this.doneButton.click();
  }
}

import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The Edit shelf modal, opened from the shelf page or the landing header. */
export class EditShelfModalComponent extends BaseComponent {
  readonly root: Locator;
  readonly nameField: Locator;
  readonly publicButton: Locator;
  readonly koboOffButton: Locator;
  readonly koboOnButton: Locator;
  readonly rulePreviewCount: Locator;
  readonly saveButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("edit-shelf-modal");
    this.nameField = this.root.getByTestId("edit-shelf-name");
    this.publicButton = this.root.getByTestId("shelf-vis-public");
    this.koboOffButton = this.root.getByTestId("edit-shelf-kobo-off");
    this.koboOnButton = this.root.getByTestId("edit-shelf-kobo-on");
    this.rulePreviewCount = this.root.getByTestId("rule-preview-count");
    this.saveButton = this.root.getByTestId("edit-shelf-save");
    this.errorMessage = this.root.getByTestId("edit-shelf-error");
  }

  /** The value box of the smart rule on row `row`, counted from 0. */
  ruleValueField(row: number): Locator {
    return this.root.getByTestId(`condition-row-${row}`).locator("input");
  }

  async rename(name: string): Promise<void> {
    await this.nameField.fill(name);
  }

  async makePublic(): Promise<void> {
    await this.publicButton.click();
  }

  async turnKoboSyncOn(): Promise<void> {
    await this.koboOnButton.click();
  }

  async changeRuleValue(row: number, value: string): Promise<void> {
    await this.ruleValueField(row).fill(value);
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }
}

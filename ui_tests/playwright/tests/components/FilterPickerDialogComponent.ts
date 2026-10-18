import type { Locator, Page } from "@playwright/test";
import type {
  FilterClause,
  FilterField,
  FilterMode,
  FilterPick,
} from "../data/libraryFilters";
import { BaseComponent } from "./BaseComponent";

/** The label of each field's button in the dialog and on its chips. */
export const FILTER_FIELD_NAMES: Record<FilterField, string> = {
  shelf: "Shelf",
  tag: "Tag",
  genre: "Genre",
  author: "Author",
  series: "Series",
  format: "Format",
};

const MODE_NAMES: Record<FilterMode, string> = {
  include: "Includes any",
  exclude: "Excludes any",
};

/** The modal "Add filter" dialog that builds one clause of the filter. */
export class FilterPickerDialogComponent extends BaseComponent {
  readonly root: Locator;
  readonly scrim: Locator;
  readonly searchField: Locator;
  readonly applyButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("dialog", { name: "Add filter" });
    this.scrim = page.getByTestId("filter-picker-scrim");
    this.searchField = this.root.getByRole("searchbox");
    this.applyButton = this.root.getByRole("button", { name: /^Apply/ });
    this.cancelButton = this.root.getByRole("button", { name: "Cancel" });
  }

  fieldButton(field: FilterField): Locator {
    return this.root.getByRole("button", {
      name: FILTER_FIELD_NAMES[field],
      exact: true,
    });
  }

  modeButton(mode: FilterMode, pressed?: boolean): Locator {
    return this.root.getByRole("button", { name: MODE_NAMES[mode], pressed });
  }

  /** The checkbox for a value, labelled by its display label. */
  option(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async chooseField(field: FilterField): Promise<void> {
    await this.fieldButton(field).click();
  }

  async chooseMode(mode: FilterMode): Promise<void> {
    await this.modeButton(mode).click();
    await this.modeButton(mode, true).waitFor();
  }

  async pick({ label, search }: FilterPick): Promise<void> {
    await this.searchField.fill(search ?? "");
    await this.option(label).check();
  }

  /** Builds `clause` in the open dialog without applying it. */
  async build({ field, mode, picks }: FilterClause): Promise<void> {
    await this.chooseField(field);
    await this.chooseMode(mode);
    for (const pick of picks) await this.pick(pick);
  }

  async apply(): Promise<void> {
    await this.applyButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async dismissByScrim(): Promise<void> {
    await this.scrim.click({ position: { x: 700, y: 600 } });
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /** The name of the dialog holding focus, or nothing when focus is outside. */
  async focusedDialogName(): Promise<string | null | undefined> {
    return this.page.evaluate(() =>
      document.activeElement
        ?.closest('[role="dialog"]')
        ?.getAttribute("aria-label"),
    );
  }
}

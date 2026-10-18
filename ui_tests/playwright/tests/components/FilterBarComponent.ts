import type { Locator, Page } from "@playwright/test";
import { clauseCount, shelvesUrls } from "../contracts/shelves";
import type { FilterClause, FilterField } from "../data/libraryFilters";
import { holdRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";
import {
  FILTER_FIELD_NAMES,
  FilterPickerDialogComponent,
} from "./FilterPickerDialogComponent";

/** The filter bar over the library list and the shelf page's members. */
export class FilterBarComponent extends BaseComponent {
  readonly picker: FilterPickerDialogComponent;

  readonly root: Locator;
  readonly addFilterButton: Locator;
  readonly clearAllButton: Locator;
  readonly chips: Locator;

  private heldReads = 0;

  constructor(page: Page) {
    super(page);
    this.picker = new FilterPickerDialogComponent(page);
    this.root = page.getByRole("group", { name: "Library filters" });
    this.addFilterButton = page.getByRole("button", { name: "+ Add filter" });
    this.clearAllButton = page.getByRole("button", { name: "Clear all" });
    this.chips = page.getByTestId(/^filter-chip-\d+$/);
  }

  chip(index: number): Locator {
    return this.page.getByTestId(`filter-chip-${index}`);
  }

  /** The button on the chip of the clause filtering by `field`. */
  removeChipButton(field: FilterField): Locator {
    return this.page.getByRole("button", {
      name: new RegExp(`^Remove filter: ${FILTER_FIELD_NAMES[field]}`),
    });
  }

  async openPicker(): Promise<void> {
    await this.addFilterButton.click();
  }

  /** Builds `clause` in the picker and applies it, which refetches the list. */
  async addClause(clause: FilterClause): Promise<void> {
    await this.openPicker();
    await this.picker.build(clause);
    await this.picker.apply();
  }

  async removeClause(field: FilterField): Promise<void> {
    await this.removeChipButton(field).click();
  }

  async clearAll(): Promise<void> {
    await this.clearAllButton.click();
  }

  /**
   * Parks the shelf member reads that carry exactly `clauses` filter clauses,
   * or every read when omitted. The release lets them through and drops every
   * route on the page.
   */
  async holdShelfReads(clauses?: number): Promise<() => Promise<void>> {
    this.heldReads = 0;
    const release = await holdRequests(
      this.page,
      shelvesUrls.page,
      (request) => {
        const parks = clauses === undefined || clauseCount(request) === clauses;
        if (parks) this.heldReads += 1;
        return parks;
      },
    );
    return async () => {
      release();
      await this.page.unrouteAll({ behavior: "wait" });
    };
  }

  /** How many parked shelf reads have reached the route. */
  heldShelfReads(): number {
    return this.heldReads;
  }
}

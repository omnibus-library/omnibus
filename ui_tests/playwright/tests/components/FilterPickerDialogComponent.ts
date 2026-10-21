import type { Locator, Page } from "@playwright/test";
import type {
  FilterClause,
  FilterField,
  FilterMode,
  FilterPick,
} from "../data/libraryFilters";
import { BaseComponent } from "./BaseComponent";

/** The label of each field's facet and of the menu it opens. */
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

/** How far a box sits inside each edge of the window, in CSS px; negative where it spills past. */
export type WindowInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** A facet's modal menu, named for its field, that builds that field's clause. */
export class FilterPickerDialogComponent extends BaseComponent {
  readonly root: Locator;
  readonly scrim: Locator;
  readonly searchField: Locator;
  readonly applyButton: Locator;
  readonly cancelButton: Locator;
  readonly loadingIndicator: Locator;
  readonly errorAlert: Locator;
  readonly retryButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("dialog", { name: /^Filter by / });
    this.scrim = page.getByTestId("filter-picker-scrim");
    this.searchField = this.root.getByRole("searchbox");
    this.applyButton = this.root.getByRole("button", { name: /^Apply/ });
    this.cancelButton = this.root.getByRole("button", { name: "Cancel" });
    this.loadingIndicator = this.root.getByTestId("filter-picker-loading");
    this.errorAlert = this.root.getByRole("alert");
    this.retryButton = this.root.getByRole("button", { name: "Try again" });
  }

  modeButton(mode: FilterMode, pressed?: boolean): Locator {
    return this.root.getByRole("button", { name: MODE_NAMES[mode], pressed });
  }

  /** The checkbox for a value, labelled by its display label. */
  option(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async chooseMode(mode: FilterMode): Promise<void> {
    await this.modeButton(mode).click();
    await this.modeButton(mode, true).waitFor();
  }

  async pick({ label, search }: FilterPick): Promise<void> {
    await this.searchField.fill(search ?? "");
    await this.option(label).check();
  }

  /** Sets `clause`'s mode and ticks its picks, on top of what the menu opened with. */
  async build({ mode, picks }: FilterClause): Promise<void> {
    await this.chooseMode(mode);
    for (const pick of picks) await this.pick(pick);
  }

  async apply(): Promise<void> {
    await this.applyButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async retry(): Promise<void> {
    await this.retryButton.click();
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

  /** Where the open menu sits against the window's edges, scrollbars excluded. */
  async insets(): Promise<WindowInsets> {
    return this.root.evaluate((menu) => {
      const box = menu.getBoundingClientRect();
      const { clientWidth, clientHeight } = document.documentElement;
      return {
        top: box.top,
        right: clientWidth - box.right,
        bottom: clientHeight - box.bottom,
        left: box.left,
      };
    });
  }
}

import type { Locator, Page } from "@playwright/test";
import { searchUrls } from "../contracts/search";
import { holdRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The command palette, opened from the top nav's search button. */
export class SearchPaletteComponent extends BaseComponent {
  readonly panel: Locator;
  readonly input: Locator;
  readonly resultCountText: Locator;
  readonly booksGroupHeading: Locator;
  readonly errorMessage: Locator;

  constructor(
    page: Page,
    private readonly searchButton: Locator,
  ) {
    super(page);
    this.panel = page.getByTestId("sp-panel");
    this.input = page.getByTestId("sp-input");
    this.resultCountText = page.getByTestId("sp-result-count");
    this.booksGroupHeading = page.getByText(/^Books · \d+$/);
    this.errorMessage = page.getByRole("alert");
  }

  /** The palette's result rows of one `kind`, such as `book` or `genre`. */
  row(kind: string): Locator {
    return this.page.getByTestId(`sp-${kind}-row`);
  }

  /** The text of every result row of one `kind`. */
  rowTexts(kind: string): Promise<string[]> {
    return this.row(kind).allInnerTexts();
  }

  /** The row of one `kind` that the arrow keys and Enter act on first. */
  topResult(kind: string): Locator {
    return this.row(kind).first();
  }

  /** The computed `padding-left` of `element`, to compare against the panel gutter. */
  leftPadding(element: Locator): Promise<string> {
    return element.evaluate((el) => getComputedStyle(el).paddingLeft);
  }

  async open(): Promise<void> {
    await this.searchButton.click();
    await this.input.waitFor();
  }

  async openWithShortcut(): Promise<void> {
    await this.page.keyboard.press("Meta+k");
  }

  async search(query: string): Promise<void> {
    await this.open();
    await this.input.fill(query);
  }

  /** Types a new query into the palette that is already open. */
  async replaceQuery(query: string): Promise<void> {
    await this.input.fill(query);
  }

  async clear(): Promise<void> {
    await this.input.fill("");
  }

  /** Types on the keyboard without clicking the input first. */
  async typeWithoutFocusing(text: string): Promise<void> {
    await this.page.keyboard.type(text);
  }

  async selectNextResult(): Promise<void> {
    await this.input.press("ArrowDown");
  }

  async selectPreviousResult(): Promise<void> {
    await this.input.press("ArrowUp");
  }

  /** Parks the library search; settings match in the browser. The release lets it through. */
  async holdLibrarySearch(): Promise<() => Promise<void>> {
    const release = await holdRequests(this.page, searchUrls.palette);
    return async () => {
      release();
      await this.page.unrouteAll({ behavior: "wait" });
    };
  }

  async submit(): Promise<void> {
    await this.input.press("Enter");
  }

  async chooseTopResult(kind: string): Promise<void> {
    await this.topResult(kind).click();
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async closeByClickingOutside(): Promise<void> {
    // A viewport point, not the scrim's box: the topbar's backdrop-filter shrinks a fixed scrim to the header strip.
    await this.page.mouse.click(40, 500);
  }
}

import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class ShelfPage extends BasePage {
  protected readonly urlPattern = /\/shelves\/\d+$/;

  readonly titleHeading: Locator;

  constructor(page: Page) {
    super(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** The `/shelves` index card that opens the shelf. */
  shelfCard(shelfId: number): Locator {
    return this.page.getByTestId(`shelf-card-${shelfId}`);
  }

  /** A book's grid tile: a `listitem`, not a link (see `landing/grid.rs`). */
  bookTile(title: string): Locator {
    return this.page.getByRole("listitem", {
      name: `Open details for ${title}`,
    });
  }

  /** Opens the shelf from its `/shelves` card, the way a reader reaches one. */
  async goto(shelfId: number): Promise<void> {
    await this.open("/shelves");
    await this.shelfCard(shelfId).click();
    await this.page.waitForURL(new RegExp(`/shelves/${shelfId}$`));
  }
}

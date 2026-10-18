import type { Locator, Page } from "@playwright/test";
import { authorBlockUrls } from "../contracts/authorBlock";
import { BaseComponent } from "./BaseComponent";

/** The More stop's author block: the other books by the book's lead author. */
export class FromSameHandComponent extends BaseComponent {
  readonly heading: Locator;
  readonly row: Locator;
  readonly tiles: Locator;
  readonly emptyMessage: Locator;
  readonly loadingNote: Locator;
  readonly onlyBookNote: Locator;

  private releaseHeldFetch?: () => void;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "From the same hand" });
    this.row = page.getByTestId("from-same-hand");
    this.tiles = this.row.getByTestId("from-same-hand-tile");
    this.emptyMessage = page.getByTestId("from-same-hand-empty");
    this.loadingNote = page.getByTestId("from-same-hand-loading");
    this.onlyBookNote = page.getByText(/only book by/);
  }

  /** The cover tile of `title`, which the row must not list for its own book. */
  coverOf(title: string): Locator {
    return this.row.getByRole("img", { name: `Cover of ${title}` });
  }

  // The stack overlaps its tiles behind the lead card and spreads them on
  // hover, so a click on a tile's centre lands on the card without it.
  async openFirstTile(): Promise<void> {
    await this.row.hover();
    await this.tiles.first().click();
  }

  /** Holds the author fetch open until `releaseAuthorFetch` lets it through. */
  async holdAuthorFetch(): Promise<void> {
    const held = new Promise<void>((resolve) => {
      this.releaseHeldFetch = resolve;
    });
    await this.page.route(authorBlockUrls.author, async (route) => {
      await held;
      await route.continue();
    });
  }

  releaseAuthorFetch(): void {
    this.releaseHeldFetch?.();
  }
}

import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** The household wishlists at `/wishlists`. */
export class WishlistsPage extends BasePage {
  protected readonly urlPattern = /\/wishlists(\?.*)?$/;

  readonly topNav: TopNavComponent;

  readonly root: Locator;
  readonly rows: Locator;
  /** The Request menu's ebook item, once a row's menu is open. */
  readonly requestEbookItem: Locator;
  readonly requestAudiobookItem: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.root = page.getByTestId("wishlists-page");
    this.rows = page.getByTestId("wishlists-row");
    this.requestEbookItem = page.getByRole("menuitem", {
      name: "Request ebook",
    });
    this.requestAudiobookItem = page.getByRole("menuitem", {
      name: /Request audiobook/,
    });
  }

  protected get readyLocator(): Locator {
    return this.root;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/wishlists");
  }

  /** The row for the book called `title`. */
  row(title: string): Locator {
    return this.rows.filter({
      has: this.page.getByRole("link", { name: title, exact: true }),
    });
  }

  /** The Request button on `title`'s row. */
  requestButton(title: string): Locator {
    return this.row(title).getByTestId("wishlists-request");
  }

  async openRequestMenu(title: string): Promise<void> {
    await this.row(title).hover();
    await this.requestButton(title).click();
  }

  /** Starts an ebook request for `title`. The page it opens is the request page. */
  async requestEbook(title: string): Promise<void> {
    await this.openRequestMenu(title);
    await this.requestEbookItem.click();
  }
}

import type { Locator, Page } from "@playwright/test";
import { physicalUrls } from "../contracts/physical";
import type { WishlistRow } from "../data/physical";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The hero rail's wishlist slot: an add button, or the card tracking a wish. */
export class WishlistCardComponent extends BaseComponent {
  readonly addButton: Locator;
  readonly card: Locator;
  readonly findCopyLink: Locator;
  private readonly removeButton: Locator;
  readonly errorMessage: Locator;
  readonly coverBadge: Locator;
  /** The viewer's Wishlist shelf in the More stop's shelf list. */
  readonly shelfTile: Locator;

  constructor(page: Page) {
    super(page);
    this.addButton = page.getByTestId("add-to-wishlist");
    this.card = page.getByTestId("wishlist-card");
    this.findCopyLink = page.getByTestId("find-a-copy");
    this.removeButton = page.getByTestId("wishlist-remove");
    this.errorMessage = page.getByTestId("wishlist-error");
    this.coverBadge = page.getByTestId("format-badge-wishlist");
    this.shelfTile = page.getByTestId(/^bdmq-shelf-\d+$/).filter({
      has: page.locator(".shv-facet--kind", { hasText: "Wishlist" }),
    });
  }

  async add(): Promise<void> {
    const added = this.page.waitForResponse(isPostTo(physicalUrls.wishlistAdd));
    await this.addButton.click();
    await added;
  }

  async remove(): Promise<void> {
    const removed = this.page.waitForResponse(
      isPostTo(physicalUrls.wishlistRemove),
    );
    await this.removeButton.click();
    await removed;
  }

  /** Answers the on-mount wishlist read: `entry`, or `null` for none. */
  async stubLoad(entry: WishlistRow | null): Promise<void> {
    await this.page.route(physicalUrls.wishlistGet, (route) =>
      route.fulfill({ json: entry }),
    );
  }

  /** Accepts a wishlist add without writing it. */
  async stubAdd(entry: WishlistRow): Promise<void> {
    await this.page.route(physicalUrls.wishlistAdd, (route) =>
      route.fulfill({ json: entry }),
    );
  }

  /** Accepts a wishlist remove without writing it. */
  async stubRemove(): Promise<void> {
    await this.page.route(physicalUrls.wishlistRemove, (route) =>
      route.fulfill({ json: { book_deleted: false } }),
    );
  }
}

import type { Locator, Page } from "@playwright/test";
import { physicalUrls } from "../contracts/physical";
import type { WishlistRow } from "../data/physical";
import { isResponseTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The copies panel's wishlist row: an add button, or the card tracking a wish. */
export class WishlistCardComponent extends BaseComponent {
  readonly addButton: Locator;
  readonly card: Locator;
  readonly findCopyLink: Locator;
  private readonly removeButton: Locator;
  readonly errorMessage: Locator;
  readonly coverBadge: Locator;
  /** The viewer's Wishlist shelf among the Overview tab's shelf chips. */
  readonly shelfTile: Locator;

  constructor(page: Page) {
    super(page);
    this.addButton = page.getByTestId("add-to-wishlist");
    this.card = page.getByTestId("wishlist-card");
    // The hero repeats both for a wished-for book, so they are found in the card.
    this.findCopyLink = this.card.getByTestId("find-a-copy");
    this.removeButton = this.card.getByTestId("wishlist-remove");
    this.errorMessage = page.getByTestId("wishlist-error");
    this.coverBadge = page.getByTestId("format-badge-wishlist");
    this.shelfTile = page
      .getByTestId(/^bp-shelf-\d+$/)
      .filter({ hasText: /Wishlist$/ });
  }

  async add(): Promise<void> {
    const added = this.page.waitForResponse(
      isResponseTo("POST", physicalUrls.wishlist),
    );
    await this.addButton.click();
    await added;
  }

  async remove(): Promise<void> {
    const removed = this.page.waitForResponse(
      isResponseTo("DELETE", physicalUrls.wishlist),
    );
    await this.removeButton.click();
    await removed;
  }

  /** Answers the on-mount wishlist read: `entry`, or `null` for none. */
  async stubLoad(entry: WishlistRow | null): Promise<void> {
    await this.page.route(physicalUrls.wishlist, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: entry })
        : route.fallback(),
    );
  }

  /** Accepts a wishlist add without writing it; the reads after it answer `entry`. */
  async stubAdd(entry: WishlistRow): Promise<void> {
    await this.stubWrite("POST", entry, entry);
  }

  /** Accepts a wishlist remove without writing it; the reads after it answer none. */
  async stubRemove(): Promise<void> {
    await this.stubWrite("DELETE", { book_deleted: false }, null);
  }

  /** Answers a `method` write with `answer`, then the page's refetch with `after`. */
  private async stubWrite(
    method: "POST" | "DELETE",
    answer: unknown,
    after: WishlistRow | null,
  ): Promise<void> {
    let written = false;
    await this.page.route(physicalUrls.wishlist, (route) => {
      const sent = route.request().method();
      if (sent === method) {
        written = true;
        return route.fulfill({ json: answer });
      }
      return sent === "GET" && written
        ? route.fulfill({ json: after })
        : route.fallback();
    });
  }
}

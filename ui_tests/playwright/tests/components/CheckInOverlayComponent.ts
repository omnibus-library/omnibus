import type { Locator, Page } from "@playwright/test";
import { scanUrls } from "../contracts/scan";
import type { ScanOutcome } from "../data/scan";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The check-in dialog, opened over whichever page the reader is on. */
export class CheckInOverlayComponent extends BaseComponent {
  readonly root: Locator;
  readonly isbnField: Locator;
  readonly findBookButton: Locator;
  readonly confirmScreen: Locator;
  readonly bookCard: Locator;
  readonly checkInButton: Locator;
  readonly addToWishlistButton: Locator;
  readonly successScreen: Locator;
  readonly offWishlistMessage: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("dialog", { name: "Check in a book" });
    this.isbnField = this.root.getByLabel("ISBN");
    this.findBookButton = this.root.getByRole("button", { name: "Find book" });
    this.confirmScreen = this.root.getByTestId("check-in-confirm");
    this.bookCard = this.root.getByTestId("check-in-book");
    this.checkInButton = this.root.getByRole("button", {
      name: "Check in",
      exact: true,
    });
    this.addToWishlistButton = this.root.getByRole("button", {
      name: "Add to my wishlist",
    });
    this.successScreen = this.root.getByTestId("check-in-success");
    this.offWishlistMessage = this.root.getByTestId("check-in-off-wishlist");
    this.closeButton = this.root.getByRole("button", {
      name: "Close",
      exact: true,
    });
  }

  /** Answers every ISBN lookup from this page with `outcome`. */
  async stubIsbnLookup(outcome: ScanOutcome): Promise<void> {
    await this.page.route(scanUrls.resolve, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: outcome })
        : route.continue(),
    );
  }

  async enterIsbn(isbn: string): Promise<void> {
    await this.isbnField.fill(isbn);
  }

  async findBook(): Promise<void> {
    const resolved = this.page.waitForResponse(isPostTo(scanUrls.resolve));
    await this.findBookButton.click();
    await resolved;
  }

  async checkInCopy(): Promise<void> {
    const checkedIn = this.page.waitForResponse(isPostTo(scanUrls.checkIn));
    await this.checkInButton.click();
    await checkedIn;
  }

  /** Wishes for the looked-up book; returns the new book's uuid. */
  async addToWishlist(): Promise<{ book_uuid: string }> {
    const added = this.page.waitForResponse(isPostTo(scanUrls.wishlist));
    await this.addToWishlistButton.click();
    return (await added).json();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
    await this.root.waitFor({ state: "hidden" });
  }
}

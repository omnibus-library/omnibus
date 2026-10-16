import type { Locator, Page } from "@playwright/test";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

export class BookDetailPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+$/;

  readonly topNav: TopNavComponent;
  readonly checkInOverlay: CheckInOverlayComponent;

  readonly titleHeading: Locator;
  readonly fromSameHandEmptyMessage: Locator;
  readonly checkInWhenAcquiredButton: Locator;
  readonly physicalCopyCards: Locator;
  readonly physicalPill: Locator;
  readonly deleteCopyButton: Locator;
  readonly lastCopyDialog: Locator;
  readonly removeFromLibraryButton: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.checkInOverlay = new CheckInOverlayComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.fromSameHandEmptyMessage = page.getByTestId("from-same-hand-empty");
    this.checkInWhenAcquiredButton = page.getByRole("button", {
      name: "Check in when acquired",
    });
    this.physicalCopyCards = page.getByTestId("physical-copy-card");
    this.physicalPill = page.getByTestId("physical-pill");
    this.deleteCopyButton = page.getByTestId("copy-delete");
    this.lastCopyDialog = page.getByTestId("last-copy-modal");
    this.removeFromLibraryButton = this.lastCopyDialog.getByRole("button", {
      name: "Remove from library",
    });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** The copy card a test filed, picked out by its unique note. */
  physicalCopyCard(note: string): Locator {
    return this.physicalCopyCards.filter({ hasText: note });
  }

  async goto(bookUuid: string): Promise<void> {
    await this.open(`/books/${bookUuid}`);
  }

  async checkInWhenAcquired(): Promise<void> {
    await this.checkInWhenAcquiredButton.click();
  }

  /** Deletes the only copy; a fileless book then asks what to do with it. */
  async deleteCopy(): Promise<void> {
    await this.deleteCopyButton.click();
  }

  async removeFromLibrary(): Promise<void> {
    await this.removeFromLibraryButton.click();
  }

  /** Checks the page is showing the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/books/${bookUuid}$`));
    await expect(this.titleHeading).toBeVisible();
  }
}

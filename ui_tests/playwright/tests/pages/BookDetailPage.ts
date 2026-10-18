import type { Locator, Page } from "@playwright/test";
import { BookDetailStopsComponent } from "../components/BookDetailStopsComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { DeleteFilesDialogComponent } from "../components/DeleteFilesDialogComponent";
import { JournalEntryOverlayComponent } from "../components/JournalEntryOverlayComponent";
import { JournalSectionComponent } from "../components/JournalSectionComponent";
import { MergeDialogComponent } from "../components/MergeDialogComponent";
import { PhysicalCopyCardComponent } from "../components/PhysicalCopyCardComponent";
import { SavedPassageCardComponent } from "../components/SavedPassageCardComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { WishlistCardComponent } from "../components/WishlistCardComponent";
import { physicalUrls } from "../contracts/physical";
import type { CopyRow, WishlistRow } from "../data/physical";
import { expect } from "../fixtures/test";
import { type ExpectMutationOptions, isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";

export class BookDetailPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+$/;

  readonly topNav: TopNavComponent;
  readonly checkInOverlay: CheckInOverlayComponent;
  readonly stops: BookDetailStopsComponent;

  readonly titleHeading: Locator;
  readonly fromSameHandEmptyMessage: Locator;
  readonly readButton: Locator;
  readonly startReadingButton: Locator;
  readonly startReadingComicButton: Locator;
  readonly startReadingPdfButton: Locator;
  readonly readPdfButton: Locator;
  readonly listenButton: Locator;
  readonly immersiveReadButton: Locator;
  readonly noFilesMessage: Locator;
  readonly checkInWhenAcquiredButton: Locator;
  readonly physicalCopyCards: Locator;
  readonly physicalPill: Locator;
  readonly removeCopyButton: Locator;
  readonly lastCopyDialog: Locator;
  readonly removeFromLibraryButton: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.checkInOverlay = new CheckInOverlayComponent(page);
    this.stops = new BookDetailStopsComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.fromSameHandEmptyMessage = page.getByTestId("from-same-hand-empty");
    this.readButton = page.getByTestId("action-read");
    // The labels change with reading progress, so the row is found by test id.
    this.startReadingButton = page.getByTestId("start-reading");
    this.startReadingComicButton = page.getByTestId("start-reading-comic");
    this.startReadingPdfButton = page.getByTestId("start-reading-pdf");
    this.readPdfButton = page.getByTestId("action-read-pdf");
    this.listenButton = page.getByTestId("listen-secondary");
    this.immersiveReadButton = page.getByTestId("immersive-read");
    this.noFilesMessage = page.getByTestId("no-files-disclaimer");
    this.checkInWhenAcquiredButton = page.getByRole("button", {
      name: "Check in when acquired",
    });
    this.physicalCopyCards = page.getByTestId("physical-copy-card");
    this.physicalPill = page.getByTestId("physical-pill");
    this.removeCopyButton = page.getByTestId("copy-delete");
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

  /** The saved-passage card whose quote contains `quote`. */
  savedPassageCard(quote: string): SavedPassageCardComponent {
    return new SavedPassageCardComponent(
      this.page,
      this.page.getByTestId("highlight-card").filter({ hasText: quote }),
    );
  }

  async goto(bookUuid: string): Promise<void> {
    await this.open(`/books/${bookUuid}`);
  }

  /** Opens the reader through the EPUB format's Read action. */
  async read(): Promise<void> {
    await this.readButton.click();
  }

  /** Opens the reader with the book's audiobook docked beside it. */
  async readImmersively(): Promise<void> {
    await this.immersiveReadButton.click();
  }

  /** Opens the comic pager through the CBZ's Start reading action. */
  async startReadingComic(): Promise<void> {
    await this.startReadingComicButton.click();
  }

  /** Opens the PDF reader through the PDF's Start reading action. */
  async startReadingPdf(): Promise<void> {
    await this.startReadingPdfButton.click();
  }

  async checkInWhenAcquired(): Promise<void> {
    await this.checkInWhenAcquiredButton.click();
  }

  /** Opens the remove dialog, with extra choices for a book's last copy. */
  async openRemoveCopyDialog(): Promise<void> {
    await this.removeCopyButton.click();
  }

  /** Deletes the last copy and its book, then waits for the book delete. */
  async removeFromLibrary(): Promise<void> {
    const removed = this.page.waitForResponse(
      isPostTo(physicalUrls.deleteBook),
    );
    await this.removeFromLibraryButton.click();
    await removed;
  }

  /** Checks the page is showing the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/books/${bookUuid}$`));
    await expect(this.titleHeading).toBeVisible();
  }

  // #region batch-C: book detail
  // #endregion batch-C

  // #region batch-D: book detail writes
  readonly journal = new JournalSectionComponent(this.page);
  readonly journalEntry = new JournalEntryOverlayComponent(this.page);
  readonly deleteFilesDialog = new DeleteFilesDialogComponent(this.page);
  readonly mergeDialog = new MergeDialogComponent(this.page);
  readonly wishlist = new WishlistCardComponent(this.page);
  readonly physicalCopy = new PhysicalCopyCardComponent(this.page);

  readonly editMetadataLink = this.page.getByTestId("edit-metadata");
  readonly formatBadges = this.page.getByTestId("format-badge");
  readonly notFoundMessage = this.page.getByText("Book not found.");

  /** The copies-list row for a format, such as `MP3`. */
  formatRow(format: string): Locator {
    return this.page.locator(`[data-format="${format}"]`).first();
  }

  /** Answers the panel's two on-mount reads, so a stub fixes what it settles on. */
  async stubPhysicalLoad(
    copies: CopyRow[],
    wishlist: WishlistRow | null,
  ): Promise<void> {
    await this.physicalCopy.stubLoad(copies);
    await this.wishlist.stubLoad(wishlist);
  }

  /** Lets requests `contract` describes through again after a forced error. */
  async stopForcingServerError(contract: ExpectMutationOptions): Promise<void> {
    await this.page.unroute(contract.url);
  }
  // #endregion batch-D

  // #region batch-E: metadata edit
  // #endregion batch-E

  // #region batch-H: filters and book-detail shelves
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  // #endregion batch-J
}

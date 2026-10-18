import type { Locator, Page } from "@playwright/test";
import { BookDetailStopsComponent } from "../components/BookDetailStopsComponent";
import { BookExportComponent } from "../components/BookExportComponent";
import { BookSummaryComponent } from "../components/BookSummaryComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { FormatSwitcherComponent } from "../components/FormatSwitcherComponent";
import { FromSameHandComponent } from "../components/FromSameHandComponent";
import { HeroChipsComponent } from "../components/HeroChipsComponent";
import { ListenFilePickerComponent } from "../components/ListenFilePickerComponent";
import { QuoteCardModalComponent } from "../components/QuoteCardModalComponent";
import { RatingComponent } from "../components/RatingComponent";
import { ReadStatusControlComponent } from "../components/ReadStatusControlComponent";
import { SavedPassageCardComponent } from "../components/SavedPassageCardComponent";
import { SavedPassagesComponent } from "../components/SavedPassagesComponent";
import { SuggestionsStripComponent } from "../components/SuggestionsStripComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { physicalUrls } from "../contracts/physical";
import { expect } from "../fixtures/test";
import { isPostTo } from "../utils/api";
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
  readonly formats = new FormatSwitcherComponent(this.page);
  readonly exportMenu = new BookExportComponent(this.page);
  readonly rating = new RatingComponent(this.page);
  readonly readStatusControl = new ReadStatusControlComponent(this.page);
  readonly savedPassages = new SavedPassagesComponent(this.page);
  readonly quoteCard = new QuoteCardModalComponent(this.page);
  readonly fromSameHand = new FromSameHandComponent(this.page);
  readonly listenFilePicker = new ListenFilePickerComponent(this.page);
  readonly heroChips = new HeroChipsComponent(this.page);
  readonly summary = new BookSummaryComponent(this.page);
  readonly suggestions = new SuggestionsStripComponent(this.page);

  readonly authorsLine = this.page.getByTestId("book-authors");
  // "From the same hand" adds a cover per tile, so the first is the hero's.
  readonly heroCover = this.page.getByTestId("cover").first();
  readonly startListeningButton = this.page.getByTestId("start-listening");

  /** The authors line's link to `name`'s page. */
  authorLink(name: string): Locator {
    return this.authorsLine.getByRole("link", { name });
  }

  /** The first link named for the series, which the kicker leads the page with. */
  seriesLink(name: RegExp): Locator {
    return this.page.getByRole("link", { name }).first();
  }

  /** Opens the book and waits for its first fetches, as `goto` does not. */
  async gotoSettled(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/books/${bookUuid}`);
  }

  async startReading(): Promise<void> {
    await this.startReadingButton.click();
  }

  async startListening(): Promise<void> {
    await this.startListeningButton.click();
  }

  async openAuthor(name: string): Promise<void> {
    await this.authorLink(name).click();
  }

  async openSeries(name: RegExp): Promise<void> {
    await this.seriesLink(name).click();
  }

  async goBack(): Promise<void> {
    await this.page.goBack();
  }

  /** The path of the page's URL, for a spec to poll when a link leaves the book. */
  async path(): Promise<string> {
    return new URL(this.page.url()).pathname;
  }

  /** Marks `window`, which a full page load clears, so a hop's staying in-app can be told. */
  async plantFullLoadSentinel(): Promise<void> {
    await this.page.evaluate(() =>
      Reflect.set(window, "__fullLoadSentinel", true),
    );
  }

  /** Whether the mark from `plantFullLoadSentinel` is still there. */
  async fullLoadSentinelSurvived(): Promise<boolean> {
    return this.page.evaluate(
      () => Reflect.get(window, "__fullLoadSentinel") === true,
    );
  }
  // #endregion batch-C

  // #region batch-D: book detail writes
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

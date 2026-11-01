import type { Locator, Page } from "@playwright/test";
import { AlignmentModalComponent } from "../components/AlignmentModalComponent";
import { BookSummaryComponent } from "../components/BookSummaryComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ChipListEditorComponent } from "../components/ChipListEditorComponent";
import { DeleteFilesDialogComponent } from "../components/DeleteFilesDialogComponent";
import { ExportMenuComponent } from "../components/ExportMenuComponent";
import { FormatRowComponent } from "../components/FormatRowComponent";
import { JournalSectionComponent } from "../components/JournalSectionComponent";
import { ListenFilePickerComponent } from "../components/ListenFilePickerComponent";
import { MergeDialogComponent } from "../components/MergeDialogComponent";
import { MiniDockComponent } from "../components/MiniDockComponent";
import { PhysicalCopyCardComponent } from "../components/PhysicalCopyCardComponent";
import { QuoteCardModalComponent } from "../components/QuoteCardModalComponent";
import { ReadStatusControlComponent } from "../components/ReadStatusControlComponent";
import { ReviewsComponent } from "../components/ReviewsComponent";
import { SavedPassageCardComponent } from "../components/SavedPassageCardComponent";
import { ShelfPickerComponent } from "../components/ShelfPickerComponent";
import { SuggestionsStripComponent } from "../components/SuggestionsStripComponent";
import { SyncLinkComponent } from "../components/SyncLinkComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { WishlistCardComponent } from "../components/WishlistCardComponent";
import { authorBlockUrls } from "../contracts/authorBlock";
import { kindleUrls } from "../contracts/kindle";
import type { KindleSendStatus } from "../data/kindle";
import type { CopyRow, WishlistRow } from "../data/physical";
import { holdRequests } from "../utils/api";
import { BasePage } from "./BasePage";

export type FormatLabel = "EPUB" | "PDF" | "MP3" | "M4B";

/** The page's four tabs, by the name each tab carries. */
export type BookTab =
  | "Overview"
  | "Reviews"
  | "Highlights & Journal"
  | "Files & Details";

export class BookDetailPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+$/;

  readonly topNav: TopNavComponent;
  readonly miniDock: MiniDockComponent;
  readonly checkInOverlay: CheckInOverlayComponent;
  readonly exportMenu: ExportMenuComponent;
  readonly reviews: ReviewsComponent;
  readonly readStatus: ReadStatusControlComponent;
  readonly quoteCardModal: QuoteCardModalComponent;
  readonly listenFilePicker: ListenFilePickerComponent;
  readonly genreChips: ChipListEditorComponent;
  readonly tagChips: ChipListEditorComponent;
  readonly summary: BookSummaryComponent;
  readonly suggestions: SuggestionsStripComponent;
  readonly journal: JournalSectionComponent;
  readonly deleteFilesDialog: DeleteFilesDialogComponent;
  readonly mergeDialog: MergeDialogComponent;
  readonly wishlist: WishlistCardComponent;
  readonly physicalCopy: PhysicalCopyCardComponent;
  readonly shelfPicker: ShelfPickerComponent;
  readonly syncLink: SyncLinkComponent;
  readonly alignmentModal: AlignmentModalComponent;

  readonly titleHeading: Locator;
  readonly authorsLine: Locator;
  readonly heroCover: Locator;
  readonly tabList: Locator;
  readonly tabs: Locator;
  readonly formatSwitcher: Locator;
  readonly formatBadges: Locator;
  readonly formatListenLinks: Locator;
  readonly savedPassagesSection: Locator;
  readonly savedPassageCards: Locator;
  readonly savedPassagesEmptyMessage: Locator;
  readonly showMorePassagesButton: Locator;
  readonly shelvesRow: Locator;
  readonly seriesShelf: Locator;
  readonly seriesPageLink: Locator;
  readonly fromSameHandHeading: Locator;
  readonly fromSameHandRow: Locator;
  readonly fromSameHandTiles: Locator;
  readonly fromSameHandLoadingMessage: Locator;
  readonly fromSameHandEmptyMessage: Locator;
  readonly bookNotFoundMessage: Locator;
  readonly startReadingButton: Locator;
  readonly startListeningButton: Locator;
  readonly startReadingComicButton: Locator;
  readonly startReadingPdfButton: Locator;
  readonly listenButton: Locator;
  readonly moreActionsButton: Locator;
  readonly immersiveReadButton: Locator;
  readonly syncImmersiveLink: Locator;
  readonly noFilesMessage: Locator;
  readonly checkInWhenAcquiredButton: Locator;
  readonly physicalPill: Locator;
  readonly editMetadataLink: Locator;
  readonly progressRuler: Locator;
  readonly addToShelfButton: Locator;
  readonly shelvesLoading: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.miniDock = new MiniDockComponent(page);
    this.checkInOverlay = new CheckInOverlayComponent(page);
    this.exportMenu = new ExportMenuComponent(page);
    this.reviews = new ReviewsComponent(page);
    this.readStatus = new ReadStatusControlComponent(page);
    this.quoteCardModal = new QuoteCardModalComponent(page);
    this.listenFilePicker = new ListenFilePickerComponent(page);
    this.genreChips = new ChipListEditorComponent(page, "genres");
    this.tagChips = new ChipListEditorComponent(page, "tags");
    this.summary = new BookSummaryComponent(page);
    this.suggestions = new SuggestionsStripComponent(page);
    this.journal = new JournalSectionComponent(page);
    this.deleteFilesDialog = new DeleteFilesDialogComponent(page);
    this.mergeDialog = new MergeDialogComponent(page);
    this.wishlist = new WishlistCardComponent(page);
    this.physicalCopy = new PhysicalCopyCardComponent(page);
    this.shelfPicker = new ShelfPickerComponent(page);
    this.syncLink = new SyncLinkComponent(page);
    this.alignmentModal = new AlignmentModalComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.authorsLine = page.getByTestId("book-authors");
    // The Overview's tiles draw covers too, and the hero has no role of its
    // own, so its cover is found inside the book on the stage.
    this.heroCover = page.locator(".bp-book").getByRole("img");
    this.tabList = page.getByRole("tablist", { name: "Book sections" });
    this.tabs = this.tabList.getByRole("tab");
    this.formatSwitcher = page.getByRole("group", {
      name: "Available formats",
    });
    this.formatBadges = this.formatSwitcher.getByTestId("format-badge");
    this.formatListenLinks = this.formatSwitcher.getByTestId("action-listen");
    this.savedPassagesSection = page.getByTestId("highlights-section");
    this.savedPassageCards = page.getByTestId("highlight-card");
    // With no journal entries either, the tab shows one note for both.
    this.savedPassagesEmptyMessage = page
      .getByTestId("highlights-empty")
      .or(page.getByTestId("highlights-journal-empty"));
    this.showMorePassagesButton = page.getByTestId("highlights-show-more");
    this.seriesShelf = page.getByRole("region", { name: / series$/ });
    this.seriesPageLink = this.seriesShelf.getByRole("link", {
      name: /series page/i,
    });
    // The Overview's "More by <author>" row.
    this.fromSameHandHeading = page.getByRole("heading", {
      name: /^More by /,
    });
    this.fromSameHandRow = page.getByTestId("bp-more-by");
    this.fromSameHandTiles =
      this.fromSameHandRow.getByTestId("bp-more-by-tile");
    this.fromSameHandLoadingMessage = page.getByTestId(
      "from-same-hand-loading",
    );
    this.fromSameHandEmptyMessage = page.getByTestId("from-same-hand-empty");
    this.bookNotFoundMessage = page.getByText("Book not found.");
    // The labels change with reading progress, so the row is found by test id.
    this.startReadingButton = page.getByTestId("start-reading");
    this.startListeningButton = page.getByTestId("start-listening");
    this.startReadingComicButton = page.getByTestId("start-reading-comic");
    this.startReadingPdfButton = page.getByTestId("start-reading-pdf");
    this.listenButton = page.getByTestId("listen-secondary");
    this.moreActionsButton = page.getByRole("button", { name: "More actions" });
    this.immersiveReadButton = page.getByRole("menuitem", {
      name: "Immersive",
    });
    this.syncImmersiveLink = page.getByTestId("sync-immersive");
    this.noFilesMessage = page.getByTestId("no-files-disclaimer");
    this.checkInWhenAcquiredButton = page.getByRole("link", {
      name: "Check in when acquired",
    });
    this.physicalPill = page.getByTestId("physical-pill");
    this.editMetadataLink = page.getByTestId("edit-metadata");
    this.progressRuler = page.getByRole("progressbar", {
      name: /^(Reading|Listening) progress$/,
    });
    this.addToShelfButton = page.getByTestId("bp-add-to-shelf");
    // The Overview's Shelves row, under the description beside Genres and Tags.
    this.shelvesRow = page
      .getByRole("definition")
      .filter({ has: this.addToShelfButton });
    this.shelvesLoading = page
      .getByRole("status")
      .filter({ hasText: "Checking your shelves" });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** The tab strip's tab called `name`. */
  tab(name: BookTab): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  /** Selects the tab called `name`; selecting the open one does nothing. */
  async openTab(name: BookTab): Promise<void> {
    await this.tab(name).click();
  }

  /** The authors line's link to the author called `name`. */
  authorLink(name: string): Locator {
    return this.authorsLine.getByRole("link", { name, exact: true });
  }

  /** The byline's series, "Pioneers, book 1", which shows its fan on the Overview. */
  seriesLink(series: string): Locator {
    return this.authorsLine.getByRole("button", {
      name: new RegExp(`^${series}(, book .+)?$`),
    });
  }

  /** The tile for the book called `title` in the "More by" row. */
  fromSameHandTile(title: string): Locator {
    return this.fromSameHandTiles.filter({ hasText: title });
  }

  /** The cover image the "More by" row draws for `title`. */
  fromSameHandCover(title: string): Locator {
    return this.fromSameHandRow.getByRole("img", {
      name: `Cover of ${title}`,
    });
  }

  /** The row the switcher draws for `format`. */
  formatRow(format: FormatLabel): FormatRowComponent {
    return new FormatRowComponent(
      this.page,
      this.formatSwitcher.getByTestId(`format-row-${format.toLowerCase()}`),
    );
  }

  /** The saved-passage card whose quote contains `quote`. */
  savedPassageCard(quote: string): SavedPassageCardComponent {
    return new SavedPassageCardComponent(
      this.page,
      this.savedPassageCards.filter({ hasText: quote }),
    );
  }

  /** The Shelves row's link to a shelf that holds the book. */
  shelfTile(shelfId: number): Locator {
    return this.page.getByTestId(`bp-shelf-${shelfId}`);
  }

  /** The × on a hand-picked shelf's chip; a smart shelf's rules hold the book, so it has none. */
  shelfTakeOffButton(shelfName: string): Locator {
    return this.shelvesRow.getByRole("button", {
      name: `Take off ${shelfName}`,
      exact: true,
    });
  }

  /** A value in the Files & Details tab's list, such as `Added`; open the tab first. */
  metaValue(label: string): Locator {
    const term = this.page
      .getByRole("term")
      .filter({ hasText: new RegExp(`^${label}$`) });
    return this.page
      .getByRole("tabpanel", { name: "Files & Details" })
      .locator("dl > div")
      .filter({ has: term })
      .getByRole("definition");
  }

  /**
   * Settles because the page fills its widgets from fetches after mount, and
   * a click that lands before they do gets overwritten.
   */
  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/books/${bookUuid}`);
  }

  /** Opens the book while a held fetch keeps the network from idling. */
  async gotoUnsettled(bookUuid: string): Promise<void> {
    await this.open(`/books/${bookUuid}`);
  }

  async startReading(): Promise<void> {
    await this.startReadingButton.click();
  }

  async startListening(): Promise<void> {
    await this.startListeningButton.click();
  }

  async openMoreActions(): Promise<void> {
    await this.moreActionsButton.click();
  }

  /** Opens the reader with the audiobook docked, from the More actions menu. */
  async readImmersively(): Promise<void> {
    await this.openMoreActions();
    await this.immersiveReadButton.click();
  }

  /** Opens the reader with the audiobook docked, from the Files & Details tab's sync row. */
  async readImmersivelyFromFiles(): Promise<void> {
    await this.openTab("Files & Details");
    await this.syncImmersiveLink.click();
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

  async openAuthor(name: string): Promise<void> {
    await this.authorLink(name).click();
  }

  async openSeries(series: string): Promise<void> {
    await this.seriesLink(series).click();
  }

  async openSeriesPage(): Promise<void> {
    await this.seriesPageLink.click();
  }

  async openSameHandBook(title: string): Promise<void> {
    await this.fromSameHandTile(title).click();
  }

  async openEditMetadata(): Promise<void> {
    await this.editMetadataLink.click();
  }

  /** Opens the picker from the Shelves row and waits for it to list shelves. */
  async openShelfPicker(): Promise<void> {
    await this.addToShelfButton.click();
    await this.shelfPicker.root.waitFor();
  }

  /**
   * Removes the directory picker on every later load, so Send to Kobo
   * downloads the file: a headless run cannot drive the picker. Call it
   * before `goto`.
   */
  async presetNoDirectoryPicker(): Promise<void> {
    await this.page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: undefined,
      });
    });
  }

  /** Records the message of every error the page throws or logs from now on, render errors a route boundary catches included. */
  recordPageErrors(): string[] {
    const errors: string[] = [];
    this.page.on("pageerror", (error) => errors.push(error.message));
    // A route's error boundary swallows a render error into `console.error`, so no `pageerror` fires; a failed request is network noise.
    this.page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().startsWith("Failed to load resource")
      )
        errors.push(message.text());
    });
    return errors;
  }

  /** Records the file name of every download the page starts from now on. */
  recordDownloads(): string[] {
    const names: string[] = [];
    this.page.on("download", (download) =>
      names.push(download.suggestedFilename()),
    );
    return names;
  }

  /**
   * Answers the Kindle send with a task id and the status poll after it with
   * `outcome`, so no SMTP relay or Kindle address is needed.
   */
  async stubKindleSend(outcome: KindleSendStatus): Promise<void> {
    await this.page.route(kindleUrls.send, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: { task_id: 1 } })
        : route.continue(),
    );
    await this.page.route(kindleUrls.sendStatus, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: outcome })
        : route.continue(),
    );
  }

  /** Answers the panel's two on-mount reads, so a stub fixes what it settles on. */
  async stubPhysicalLoad(
    copies: CopyRow[],
    wishlist: WishlistRow | null,
  ): Promise<void> {
    await this.physicalCopy.stubLoad(copies);
    await this.wishlist.stubLoad(wishlist);
  }

  /** Holds the author fetch open until the returned release lets it through. */
  async holdAuthorFetch(): Promise<() => void> {
    return holdRequests(this.page, authorBlockUrls.author);
  }

  /** Checks the page is showing the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`/books/${bookUuid}$`));
  }

  /** Checks the page is a book's uuid route, whichever book, and not a numeric id. */
  async assertDisplayedByUuid(): Promise<void> {
    await this.assertDisplayedAt(/\/books\/[0-9a-fA-F-]{36}$/);
  }
}

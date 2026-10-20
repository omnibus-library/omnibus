import type { Locator, Page } from "@playwright/test";
import { AlignmentModalComponent } from "../components/AlignmentModalComponent";
import { BookSummaryComponent } from "../components/BookSummaryComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ChipListEditorComponent } from "../components/ChipListEditorComponent";
import { DeleteFilesDialogComponent } from "../components/DeleteFilesDialogComponent";
import { ExportMenuComponent } from "../components/ExportMenuComponent";
import { FormatRowComponent } from "../components/FormatRowComponent";
import { JournalEntryOverlayComponent } from "../components/JournalEntryOverlayComponent";
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
import { accountUrls } from "../contracts/account";
import { authorBlockUrls } from "../contracts/authorBlock";
import { kindleUrls } from "../contracts/kindle";
import type { KindleSendStatus } from "../data/kindle";
import type { CopyRow, WishlistRow } from "../data/physical";
import { holdRequests, isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";

/** The seven stops of the page in running order, as the dot rail names them. */
const MARQUEE_SECTIONS = [
  "Home",
  "Stats",
  "Reviews",
  "Highlights",
  "Journals",
  "The files",
  "More",
] as const;

export type MarqueeSection = (typeof MARQUEE_SECTIONS)[number];

export type FormatLabel = "EPUB" | "PDF" | "MP3" | "M4B";

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
  readonly journalEntry: JournalEntryOverlayComponent;
  readonly deleteFilesDialog: DeleteFilesDialogComponent;
  readonly mergeDialog: MergeDialogComponent;
  readonly wishlist: WishlistCardComponent;
  readonly physicalCopy: PhysicalCopyCardComponent;
  readonly shelfPicker: ShelfPickerComponent;
  readonly syncLink: SyncLinkComponent;
  readonly alignmentModal: AlignmentModalComponent;

  readonly titleHeading: Locator;
  readonly authorsLine: Locator;
  readonly heroCoverFrame: Locator;
  readonly heroCover: Locator;
  readonly sectionsNav: Locator;
  readonly sectionDots: Locator;
  readonly scrollStopsToggleButton: Locator;
  readonly railScrollStopsToggleButton: Locator;
  readonly scrollStopsErrorMessage: Locator;
  readonly flowScroller: Locator;
  readonly snapScroller: Locator;
  readonly flowSections: Locator;
  readonly leadFlowSection: Locator;
  readonly leadFlowSectionLabels: Locator;
  readonly flowSectionLabels: Locator;
  readonly nextStopCues: Locator;
  readonly snapSections: Locator;
  readonly backToBookButton: Locator;
  readonly formatSwitcher: Locator;
  readonly formatBadges: Locator;
  readonly formatListenLinks: Locator;
  readonly savedPassagesHeading: Locator;
  readonly savedPassagesSection: Locator;
  readonly savedPassageCards: Locator;
  readonly savedPassagesEmptyMessage: Locator;
  readonly showMorePassagesButton: Locator;
  readonly moreStop: Locator;
  readonly seriesShelf: Locator;
  readonly seriesPageLink: Locator;
  readonly fromSameHandHeading: Locator;
  readonly fromSameHandRow: Locator;
  readonly fromSameHandTiles: Locator;
  readonly fromSameHandLoadingMessage: Locator;
  readonly fromSameHandEmptyMessage: Locator;
  readonly onlyBookByNote: Locator;
  readonly bookNotFoundMessage: Locator;
  readonly startReadingButton: Locator;
  readonly startListeningButton: Locator;
  readonly startReadingComicButton: Locator;
  readonly startReadingPdfButton: Locator;
  readonly listenButton: Locator;
  readonly immersiveReadButton: Locator;
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
    this.journalEntry = new JournalEntryOverlayComponent(page);
    this.deleteFilesDialog = new DeleteFilesDialogComponent(page);
    this.mergeDialog = new MergeDialogComponent(page);
    this.wishlist = new WishlistCardComponent(page);
    this.physicalCopy = new PhysicalCopyCardComponent(page);
    this.shelfPicker = new ShelfPickerComponent(page);
    this.syncLink = new SyncLinkComponent(page);
    this.alignmentModal = new AlignmentModalComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.authorsLine = page.getByTestId("book-authors");
    // The More stop's tiles draw covers too, so the hero's is found by its
    // wrapper, which is hidden from the accessibility tree.
    this.heroCoverFrame = page.locator("#bdmq-coverpx");
    this.heroCover = this.heroCoverFrame.getByTestId("cover");
    this.sectionsNav = page.getByRole("navigation", { name: "Page sections" });
    this.sectionDots = this.sectionsNav.getByRole("button");
    // A test asserts the toggle absent from the rail, so it keeps its test id.
    this.scrollStopsToggleButton = page.getByTestId("bdmq-mode-toggle");
    this.railScrollStopsToggleButton =
      this.sectionsNav.getByTestId("bdmq-mode-toggle");
    // Other alerts share the page, so the toggle's is found by test id.
    this.scrollStopsErrorMessage = page.getByTestId("bdmq-mode-error");
    // The scrollers and their sections carry no role, and the `bdmq-sec-{i}`
    // ids render in both modes, so the modes are told apart by class.
    this.flowScroller = page.locator("#bdmq-flow");
    this.snapScroller = page.locator("#bdmq-snap");
    this.flowSections = page.locator(".bdmq-flowsec");
    this.leadFlowSection = page.locator(".bdmq-flowsec.lead");
    this.leadFlowSectionLabels = this.leadFlowSection.locator(".bdmq-flowlab");
    this.flowSectionLabels = page.locator(".bdmq-flowlab");
    this.nextStopCues = page.locator(".bdmq-next");
    this.snapSections = page.locator(".bdmq-sec");
    this.backToBookButton = page.getByTestId("bdmq-flowtop");
    this.formatSwitcher = page.getByRole("group", {
      name: "Available formats",
    });
    this.formatBadges = this.formatSwitcher.getByTestId("format-badge");
    this.formatListenLinks = this.formatSwitcher.getByTestId("action-listen");
    this.savedPassagesHeading = page.getByRole("heading", {
      name: "Passages you saved",
    });
    this.savedPassagesSection = page.getByTestId("highlights-section");
    this.savedPassageCards = page.getByTestId("highlight-card");
    this.savedPassagesEmptyMessage = page.getByTestId("highlights-empty");
    this.showMorePassagesButton = page.getByTestId("highlights-show-more");
    this.moreStop = page.getByTestId("bdmq-more");
    this.seriesShelf = page.getByTestId("bdmq-series-shelf");
    this.seriesPageLink = page.getByRole("link", { name: /series page/ });
    this.fromSameHandHeading = page.getByRole("heading", {
      name: "From the same hand",
    });
    this.fromSameHandRow = page.getByTestId("from-same-hand");
    this.fromSameHandTiles = this.fromSameHandRow.getByTestId(
      "from-same-hand-tile",
    );
    this.fromSameHandLoadingMessage = page.getByTestId(
      "from-same-hand-loading",
    );
    this.fromSameHandEmptyMessage = page.getByTestId("from-same-hand-empty");
    this.onlyBookByNote = page.getByText(/only book by/);
    this.bookNotFoundMessage = page.getByText("Book not found.");
    // The labels change with reading progress, so the row is found by test id.
    this.startReadingButton = page.getByTestId("start-reading");
    this.startListeningButton = page.getByTestId("start-listening");
    this.startReadingComicButton = page.getByTestId("start-reading-comic");
    this.startReadingPdfButton = page.getByTestId("start-reading-pdf");
    this.listenButton = page.getByTestId("listen-secondary");
    this.immersiveReadButton = page.getByTestId("immersive-read");
    this.noFilesMessage = page.getByTestId("no-files-disclaimer");
    this.checkInWhenAcquiredButton = page.getByRole("button", {
      name: "Check in when acquired",
    });
    this.physicalPill = page.getByTestId("physical-pill");
    this.editMetadataLink = page.getByTestId("edit-metadata");
    this.progressRuler = page.getByTestId("bdmq-ruler");
    this.addToShelfButton = page.getByTestId("bdmq-add-to-shelf");
    this.shelvesLoading = page.getByTestId("bdmq-shelves-loading");
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** The authors line's link to the author called `name`. */
  authorLink(name: string): Locator {
    return this.authorsLine.getByRole("link", { name, exact: true });
  }

  /** The kicker's link to `series`; exact, so the More stop's covers miss. */
  seriesLink(series: string): Locator {
    return this.page.getByRole("link", { name: series, exact: true });
  }

  /** The tile for the book called `title` in the "From the same hand" row. */
  fromSameHandTile(title: string): Locator {
    return this.fromSameHandTiles.filter({ hasText: title });
  }

  /** The cover image the "From the same hand" row draws for `title`. */
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

  /** The dot rail's button for `section`; its label reads "NN · Name". */
  sectionDot(section: MarqueeSection): Locator {
    return this.sectionsNav.getByRole("button", {
      name: new RegExp(`${section}$`, "i"),
    });
  }

  /** The panel holding `section`, in whichever reading the page is in. */
  sectionPanel(section: MarqueeSection): Locator {
    return this.page.getByTestId(
      `bdmq-sec-${MARQUEE_SECTIONS.indexOf(section)}`,
    );
  }

  /** The snapped screen's label for `section`, which fades as the screen leaves. */
  sectionLabel(section: MarqueeSection): Locator {
    return this.sectionPanel(section).locator(".bdmq-seclab");
  }

  /** The "scroll, next" cue under the snapped screen for `section`. */
  nextStopCue(section: MarqueeSection): Locator {
    return this.sectionPanel(section).locator(".bdmq-next");
  }

  /** The saved-passage card whose quote contains `quote`. */
  savedPassageCard(quote: string): SavedPassageCardComponent {
    return new SavedPassageCardComponent(
      this.page,
      this.savedPassageCards.filter({ hasText: quote }),
    );
  }

  /** The More stop's tile for a shelf that holds the book. */
  shelfTile(shelfId: number): Locator {
    return this.page.getByTestId(`bdmq-shelf-${shelfId}`);
  }

  /** The Hand-picked or Smart facet on a shelf's tile. */
  shelfTileKind(shelfId: number): Locator {
    return this.shelfTile(shelfId).locator(".shv-facet--kind");
  }

  /** The book's details table: label and value rows such as `Added`. */
  metaValue(label: string): Locator {
    const labelCell = this.page.locator(".bd-meta-k", {
      hasText: new RegExp(`^${label}$`),
    });
    return this.page
      .locator("tr.bd-meta-row")
      .filter({ has: labelCell })
      .locator(".bd-meta-v");
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

  async openAuthor(name: string): Promise<void> {
    await this.authorLink(name).click();
  }

  async openSeries(series: string): Promise<void> {
    await this.seriesLink(series).click();
  }

  async openSeriesPage(): Promise<void> {
    await this.seriesPageLink.click();
  }

  /**
   * Hovers the row first: until then the stack overlaps its tiles behind the
   * author card, which would take the click.
   */
  async openSameHandBook(title: string): Promise<void> {
    await this.fromSameHandRow.hover();
    await this.fromSameHandTile(title).click();
  }

  async openEditMetadata(): Promise<void> {
    await this.editMetadataLink.click();
  }

  /** Opens the picker from the More stop and waits for it to list shelves. */
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

  /**
   * Records every panic the app reports from now on: a Rust panic in the
   * wasm client logs "panicked at" to the console, and the page stops
   * answering.
   */
  recordPanics(): string[] {
    const panics: string[] = [];
    const note = (text: string) => {
      if (/panicked/i.test(text)) panics.push(text);
    };
    this.page.on("console", (message) => note(message.text()));
    this.page.on("pageerror", (error) => note(error.message));
    return panics;
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
        ? route.fulfill({ json: 1 })
        : route.continue(),
    );
    await this.page.route(kindleUrls.sendStatus, (route) =>
      route.request().method() === "POST"
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

  /** Scrolls to `section` through its dot on the rail. */
  async jumpToSection(section: MarqueeSection): Promise<void> {
    await this.sectionDot(section).click();
  }

  /** Scrolls the continuous flow to `top` pixels from its start. */
  async scrollFlowTo(top: number): Promise<void> {
    await this.flowScroller.evaluate((el, top) => {
      el.scrollTop = top;
    }, top);
  }

  /** Scrolls the continuous flow until `section` starts at its top. */
  async scrollFlowToSection(section: MarqueeSection): Promise<void> {
    const top = await this.sectionPanel(section).evaluate(
      (el: HTMLElement) => el.offsetTop,
    );
    await this.scrollFlowTo(top);
  }

  /** Scrolls the snap marquee to the screen holding `section`. */
  async scrollMarqueeToStop(section: MarqueeSection): Promise<void> {
    await this.snapScroller.evaluate((el, index) => {
      el.scrollTop = index * el.clientHeight;
    }, MARQUEE_SECTIONS.indexOf(section));
  }

  /** Flips the stage's scroll stops toggle and waits for the save. */
  async toggleScrollStops(): Promise<void> {
    const saved = this.page.waitForResponse(isPostTo(accountUrls.scrollStops));
    await this.scrollStopsToggleButton.click();
    await saved;
  }

  /** Scrolls the flow until the journal's new entry sits level with the rail. */
  async alignNewJournalEntryWithRail(): Promise<void> {
    const [entry, rail] = await Promise.all([
      this.journal.newEntryButton.boundingBox(),
      this.sectionsNav.boundingBox(),
    ]);
    if (!entry || !rail) {
      throw new Error("the new journal entry and the dot rail must both show");
    }
    const offset = entry.y + entry.height / 2 - (rail.y + rail.height / 2);
    await this.flowScroller.evaluate((el, by) => {
      el.scrollTop += by;
    }, offset);
  }

  async backToBook(): Promise<void> {
    await this.backToBookButton.click();
  }

  async flowScrollTop(): Promise<number> {
    return this.flowScroller.evaluate((el) => el.scrollTop);
  }

  /** The cover's inline transform, which the scroll glue rewrites as it runs. */
  async coverTransform(): Promise<string> {
    return this.heroCoverFrame.evaluate((el) => el.style.transform);
  }

  /** The scroll stops toggle's bottom edge and the dot rail's top edge, in px. */
  async toggleAndRailEdges(): Promise<{
    toggleBottom: number;
    railTop: number;
  }> {
    const [toggle, rail] = await Promise.all([
      this.scrollStopsToggleButton.boundingBox(),
      this.sectionsNav.boundingBox(),
    ]);
    if (!toggle || !rail) {
      throw new Error(
        "the scroll stops toggle and the dot rail must both show",
      );
    }
    return { toggleBottom: toggle.y + toggle.height, railTop: rail.y };
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

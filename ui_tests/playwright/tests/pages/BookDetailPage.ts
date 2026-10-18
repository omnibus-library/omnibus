import type { Locator, Page } from "@playwright/test";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ChipListEditorComponent } from "../components/ChipListEditorComponent";
import { ExportMenuComponent } from "../components/ExportMenuComponent";
import { FormatRowComponent } from "../components/FormatRowComponent";
import { ListenFilePickerComponent } from "../components/ListenFilePickerComponent";
import { QuoteCardModalComponent } from "../components/QuoteCardModalComponent";
import { RatingComponent } from "../components/RatingComponent";
import { ReadStatusControlComponent } from "../components/ReadStatusControlComponent";
import { SavedPassageCardComponent } from "../components/SavedPassageCardComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { accountUrls } from "../contracts/account";
import { kindleUrls } from "../contracts/kindle";
import { physicalUrls } from "../contracts/physical";
import type { KindleSendStatus } from "../data/kindle";
import { expect } from "../fixtures/test";
import { isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";

/** The six stops of the page in running order, as the dot rail names them. */
const MARQUEE_SECTIONS = [
  "Home",
  "Stats",
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
  readonly checkInOverlay: CheckInOverlayComponent;
  readonly exportMenu: ExportMenuComponent;
  readonly rating: RatingComponent;
  readonly readStatus: ReadStatusControlComponent;
  readonly quoteCardModal: QuoteCardModalComponent;
  readonly listenFilePicker: ListenFilePickerComponent;
  readonly genreChips: ChipListEditorComponent;
  readonly tagChips: ChipListEditorComponent;

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
  readonly formatListenLinks: Locator;
  readonly savedPassagesHeading: Locator;
  readonly savedPassagesSection: Locator;
  readonly savedPassageCards: Locator;
  readonly savedPassagesEmptyMessage: Locator;
  readonly showMorePassagesButton: Locator;
  readonly newJournalEntryButton: Locator;
  readonly journalComposer: Locator;
  readonly cancelJournalEntryButton: Locator;
  readonly moreStop: Locator;
  readonly fromSameHandHeading: Locator;
  readonly fromSameHandRow: Locator;
  readonly fromSameHandTiles: Locator;
  readonly fromSameHandLoadingMessage: Locator;
  readonly onlyBookByNote: Locator;
  readonly suggestionsStrip: Locator;
  readonly suggestionsHeading: Locator;
  readonly bookNotFoundMessage: Locator;
  readonly fromSameHandEmptyMessage: Locator;
  readonly readButton: Locator;
  readonly startReadingButton: Locator;
  readonly startListeningButton: Locator;
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
    this.exportMenu = new ExportMenuComponent(page);
    this.rating = new RatingComponent(page);
    this.readStatus = new ReadStatusControlComponent(page);
    this.quoteCardModal = new QuoteCardModalComponent(page);
    this.listenFilePicker = new ListenFilePickerComponent(page);
    this.genreChips = new ChipListEditorComponent(page, "genres");
    this.tagChips = new ChipListEditorComponent(page, "tags");
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
    this.formatListenLinks = this.formatSwitcher.getByTestId("action-listen");
    this.savedPassagesHeading = page.getByRole("heading", {
      name: "Passages you saved",
    });
    this.savedPassagesSection = page.getByTestId("highlights-section");
    this.savedPassageCards = page.getByTestId("highlight-card");
    this.savedPassagesEmptyMessage = page.getByTestId("highlights-empty");
    this.showMorePassagesButton = page.getByTestId("highlights-show-more");
    this.newJournalEntryButton = page.getByRole("button", {
      name: "New entry",
    });
    this.journalComposer = page.getByTestId("journal-composer");
    this.cancelJournalEntryButton = this.journalComposer.getByRole("button", {
      name: "Cancel",
      exact: true,
    });
    this.moreStop = page.getByTestId("bdmq-more");
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
    this.onlyBookByNote = page.getByText(/only book by/);
    this.suggestionsStrip = page.getByTestId("suggestions-strip");
    this.suggestionsHeading = page.getByRole("heading", {
      name: "Suggested for you",
    });
    this.bookNotFoundMessage = page.getByText("Book not found.");
    this.fromSameHandEmptyMessage = page.getByTestId("from-same-hand-empty");
    this.readButton = page.getByTestId("action-read");
    // The labels change with reading progress, so the row is found by test id.
    this.startReadingButton = page.getByTestId("start-reading");
    this.startListeningButton = page.getByTestId("start-listening");
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

  /** The authors line's link to the author called `name`. */
  authorLink(name: string): Locator {
    return this.authorsLine.getByRole("link", { name, exact: true });
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

  /** The kicker's link to `series`; exact, so the More stop's covers miss. */
  seriesLink(series: string): Locator {
    return this.page.getByRole("link", { name: series, exact: true });
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

  /** The copy card a test filed, picked out by its unique note. */
  physicalCopyCard(note: string): Locator {
    return this.physicalCopyCards.filter({ hasText: note });
  }

  /** The saved-passage card whose quote contains `quote`. */
  savedPassageCard(quote: string): SavedPassageCardComponent {
    return new SavedPassageCardComponent(
      this.page,
      this.savedPassageCards.filter({ hasText: quote }),
    );
  }

  /**
   * Settles because the page fills its widgets from fetches after mount, and
   * a click that lands before they do gets overwritten.
   */
  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/books/${bookUuid}`);
  }

  /**
   * Opens the book without waiting for the network to settle, for a test that
   * holds a request open: the page never goes idle while it is held.
   */
  async gotoWhileLoading(bookUuid: string): Promise<void> {
    await this.open(`/books/${bookUuid}`);
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

  async openSeries(series: string): Promise<void> {
    await this.seriesLink(series).click();
  }

  /**
   * Hovers the row first: until then the stack overlaps its tiles behind the
   * author card, which would take the click.
   */
  async openSameHandBook(title: string): Promise<void> {
    await this.fromSameHandRow.hover();
    await this.fromSameHandTile(title).click();
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
   * Answers the Kindle send with a task id and the status poll after it with
   * `outcome`, so no SMTP relay or Kindle address is needed.
   */
  async stubKindleSend(outcome: KindleSendStatus): Promise<void> {
    await this.page.route(kindleUrls.send, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: 1 })
        : route.continue(),
    );
    await this.page.route(kindleUrls.status, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: outcome })
        : route.continue(),
    );
  }

  /** Holds the author fetch open until the returned function lets it go. */
  async holdAuthorFetch(): Promise<() => void> {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Web fetches the author through the server function, not the REST route.
    await this.page.route("**/api/rpc/author", async (route) => {
      await held;
      await route.continue();
    });
    return release;
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

  /** Scrolls the flow until the new journal entry sits level with the rail. */
  async alignNewJournalEntryWithRail(): Promise<void> {
    const [entry, rail] = await Promise.all([
      this.newJournalEntryButton.boundingBox(),
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

  /**
   * Clicks the new journal entry 4px from its rail-side end with a real
   * pointer, since `click()` would retry around anything covering the spot.
   */
  async openJournalComposerBesideRail(): Promise<void> {
    const box = await this.newJournalEntryButton.boundingBox();
    if (!box) {
      throw new Error("the new journal entry must show");
    }
    await this.page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  }

  async cancelJournalEntry(): Promise<void> {
    await this.cancelJournalEntryButton.click();
  }

  async backToBook(): Promise<void> {
    await this.backToBookButton.click();
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
    await expect(this.page).toHaveURL(new RegExp(`/books/${bookUuid}$`));
    await expect(this.titleHeading).toBeVisible();
  }
}

import type { Locator, Page } from "@playwright/test";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ChipListEditorComponent } from "../components/ChipListEditorComponent";
import { RatingComponent } from "../components/RatingComponent";
import { SavedPassageCardComponent } from "../components/SavedPassageCardComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { physicalUrls } from "../contracts/physical";
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

export class BookDetailPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+$/;

  readonly topNav: TopNavComponent;
  readonly checkInOverlay: CheckInOverlayComponent;
  readonly rating: RatingComponent;
  readonly genreChips: ChipListEditorComponent;
  readonly tagChips: ChipListEditorComponent;

  readonly titleHeading: Locator;
  readonly authorsLine: Locator;
  readonly heroCover: Locator;
  readonly sectionsNav: Locator;
  readonly sectionDots: Locator;
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
  readonly savedPassagesHeading: Locator;
  readonly savedPassagesSection: Locator;
  readonly moreStop: Locator;
  readonly fromSameHandHeading: Locator;
  readonly suggestionsStrip: Locator;
  readonly suggestionsHeading: Locator;
  readonly bookNotFoundMessage: Locator;
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
    this.rating = new RatingComponent(page);
    this.genreChips = new ChipListEditorComponent(page, "genres");
    this.tagChips = new ChipListEditorComponent(page, "tags");
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.authorsLine = page.getByTestId("book-authors");
    // The More stop's tiles draw covers too, so the hero's is found by its
    // wrapper, which is hidden from the accessibility tree.
    this.heroCover = page.locator("#bdmq-coverpx").getByTestId("cover");
    this.sectionsNav = page.getByRole("navigation", { name: "Page sections" });
    this.sectionDots = this.sectionsNav.getByRole("button");
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
    this.savedPassagesHeading = page.getByRole("heading", {
      name: "Passages you saved",
    });
    this.savedPassagesSection = page.getByTestId("highlights-section");
    this.moreStop = page.getByTestId("bdmq-more");
    this.fromSameHandHeading = page.getByRole("heading", {
      name: "From the same hand",
    });
    this.suggestionsStrip = page.getByTestId("suggestions-strip");
    this.suggestionsHeading = page.getByRole("heading", {
      name: "Suggested for you",
    });
    this.bookNotFoundMessage = page.getByText("Book not found.");
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

  /** The authors line's link to the author called `name`. */
  authorLink(name: string): Locator {
    return this.authorsLine.getByRole("link", { name, exact: true });
  }

  /** The dot rail's button for `section`; its label reads "NN · Name". */
  sectionDot(section: MarqueeSection): Locator {
    return this.sectionsNav.getByRole("button", {
      name: new RegExp(`${section}$`, "i"),
    });
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

  /**
   * Settles because the page fills its widgets from fetches after mount, and
   * a click that lands before they do gets overwritten.
   */
  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/books/${bookUuid}`);
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

  /** Scrolls the snap marquee to the screen holding `section`. */
  async scrollMarqueeToStop(section: MarqueeSection): Promise<void> {
    await this.snapScroller.evaluate((el, index) => {
      el.scrollTop = index * el.clientHeight;
    }, MARQUEE_SECTIONS.indexOf(section));
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
    return this.page
      .locator("#bdmq-coverpx")
      .evaluate((el) => el.style.transform);
  }

  /** Checks the page is showing the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/books/${bookUuid}$`));
    await expect(this.titleHeading).toBeVisible();
  }
}

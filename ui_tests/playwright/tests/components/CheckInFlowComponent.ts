import type { Locator, Page } from "@playwright/test";
import { paletteUrls } from "../contracts/palette";
import { scanUrls } from "../contracts/scan";
import type { ExternalBookMeta, ScanOutcome } from "../data/scan";
import { type ExpectMutationOptions, isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/**
 * The check-in wizard, one screen at a time: lookup, scanner, keypad, then
 * whichever outcome the ISBN resolves to. Rooted on its host, which is the
 * `/check-in` page's card or the overlay's dialog.
 */
export class CheckInFlowComponent extends BaseComponent {
  readonly screenHeading: Locator;
  readonly errorMessage: Locator;
  readonly cancelLink: Locator;

  readonly lookupScreen: Locator;
  readonly isbnField: Locator;
  readonly findBookButton: Locator;
  readonly titleSearchForm: Locator;
  readonly titleField: Locator;
  readonly searchButton: Locator;
  readonly searchResultButtons: Locator;
  readonly searchEmptyMessage: Locator;
  readonly scanBarcodeButton: Locator;
  readonly fallbackNoteMessage: Locator;

  readonly scanScreen: Locator;
  readonly scannerPanel: Locator;
  readonly scannerVideo: Locator;
  readonly scannerStatusMessage: Locator;
  readonly enterIsbnInsteadButton: Locator;
  readonly searchByTitleButton: Locator;

  readonly keypadScreen: Locator;
  readonly isbnProgressStrip: Locator;
  private readonly keypad: Locator;

  readonly unresolvedScreen: Locator;
  readonly searchByTitleInsteadButton: Locator;

  readonly confirmScreen: Locator;
  readonly bookCards: Locator;
  readonly bookSeriesText: Locator;
  readonly bookDetailText: Locator;
  readonly noteField: Locator;
  readonly checkInButton: Locator;
  readonly cancelButton: Locator;

  readonly closeMatchScreen: Locator;
  readonly closeMatchPickButtons: Locator;
  readonly declineCloseMatchButton: Locator;

  readonly chooseScreen: Locator;
  readonly ownItButton: Locator;
  readonly addToWishlistButton: Locator;
  readonly linkExistingButton: Locator;

  readonly linkScreen: Locator;
  readonly libraryQueryField: Locator;
  readonly searchLibraryButton: Locator;
  readonly linkResultsList: Locator;
  readonly linkPickButtons: Locator;
  readonly linkEmptyMessage: Locator;
  readonly linkBackButton: Locator;

  readonly successScreen: Locator;
  readonly offWishlistMessage: Locator;
  readonly viewBookLink: Locator;

  constructor(
    page: Page,
    readonly root: Locator,
  ) {
    super(page);
    this.screenHeading = root.getByRole("heading", { level: 1 });
    this.errorMessage = root.getByRole("alert");
    this.cancelLink = root.getByTestId("check-in-close");

    this.lookupScreen = root.getByTestId("check-in-lookup");
    this.isbnField = root.getByLabel("ISBN");
    this.findBookButton = root.getByRole("button", { name: "Find book" });
    this.titleSearchForm = root.getByTestId("check-in-search");
    this.titleField = root.getByLabel("Title", { exact: true });
    this.searchButton = root.getByRole("button", {
      name: "Search",
      exact: true,
    });
    this.searchResultButtons = root.getByTestId("check-in-search-result");
    this.searchEmptyMessage = root.getByTestId("check-in-search-empty");
    this.scanBarcodeButton = root.getByRole("button", {
      name: "Scan a barcode",
    });
    this.fallbackNoteMessage = root.getByTestId("check-in-google-books-note");

    this.scanScreen = root.getByTestId("check-in-scan");
    this.scannerPanel = root.getByTestId("barcode-scanner");
    this.scannerVideo = root.getByTestId("barcode-scanner-video");
    this.scannerStatusMessage = root.getByTestId("barcode-scanner-status");
    this.enterIsbnInsteadButton = root.getByRole("button", {
      name: "Enter ISBN instead",
    });
    this.searchByTitleButton = root.getByRole("button", {
      name: "Search by title",
      exact: true,
    });

    this.keypadScreen = root.getByTestId("check-in-entry");
    this.isbnProgressStrip = root.getByTestId("check-in-isbn-progress");
    this.keypad = root.getByTestId("check-in-keypad");

    this.unresolvedScreen = root.getByTestId("check-in-unresolved");
    this.searchByTitleInsteadButton = root.getByRole("button", {
      name: "Search by title instead",
    });

    this.confirmScreen = root.getByTestId("check-in-confirm");
    this.bookCards = root.getByTestId("check-in-book");
    this.bookSeriesText = root.getByTestId("check-in-book-series");
    this.bookDetailText = root.getByTestId("check-in-book-detail");
    this.noteField = root.getByLabel("Edition note");
    this.checkInButton = root.getByRole("button", {
      name: "Check in",
      exact: true,
    });
    this.cancelButton = root.getByRole("button", {
      name: "Cancel",
      exact: true,
    });

    this.closeMatchScreen = root.getByTestId("check-in-close-match");
    this.closeMatchPickButtons = root.getByTestId("check-in-close-match-pick");
    this.declineCloseMatchButton = root.getByTestId("check-in-close-match-no");

    this.chooseScreen = root.getByTestId("check-in-choose");
    this.ownItButton = root.getByRole("button", { name: "I own it" });
    this.addToWishlistButton = root.getByRole("button", {
      name: "Add to my wishlist",
    });
    this.linkExistingButton = root.getByRole("button", {
      name: "I already have this book",
    });

    this.linkScreen = root.getByTestId("check-in-link");
    this.libraryQueryField = root.getByLabel("Title or author");
    this.searchLibraryButton = root.getByRole("button", {
      name: "Search my library",
    });
    this.linkResultsList = root.getByTestId("check-in-link-results");
    this.linkPickButtons = root.getByTestId("check-in-link-pick");
    this.linkEmptyMessage = root.getByTestId("check-in-link-empty");
    this.linkBackButton = root.getByRole("button", {
      name: "Back",
      exact: true,
    });

    this.successScreen = root.getByTestId("check-in-success");
    this.offWishlistMessage = root.getByTestId("check-in-off-wishlist");
    this.viewBookLink = root.getByRole("link", { name: "View book" });
  }

  /** A keypad key: a digit, or `"Delete"` for backspace. */
  keypadButton(key: string): Locator {
    return this.keypad.getByRole("button", { name: key, exact: true });
  }

  /** The title search result for the book titled exactly `title`. */
  searchResultButton(title: string): Locator {
    return this.searchResultButtons.filter({ has: this.titleText(title) });
  }

  /** The pick button beside the close match titled exactly `title`. */
  closeMatchPickButton(title: string): Locator {
    return this.pickerRow(this.closeMatchScreen, title).getByTestId(
      "check-in-close-match-pick",
    );
  }

  /** The pick button beside the library book titled exactly `title`. */
  linkPickButton(title: string): Locator {
    return this.pickerRow(this.linkResultsList, title).getByTestId(
      "check-in-link-pick",
    );
  }

  /** Answers every ISBN lookup from this page with `outcome`. */
  async stubIsbnLookup(outcome: ScanOutcome): Promise<void> {
    await this.stubPost(scanUrls.resolve, outcome);
  }

  /** Answers every title search from this page with `results`. */
  async stubTitleSearch(results: ExternalBookMeta[]): Promise<void> {
    await this.stubPost(scanUrls.search, { results });
  }

  /** Answers the pick of any title-search result with `outcome`. */
  async stubSearchPick(outcome: ScanOutcome): Promise<void> {
    await this.stubPost(scanUrls.resolveMeta, outcome);
  }

  /** Pins the Google Books key status, which any settings save can flip. */
  async stubGoogleBooksKey(configured: boolean): Promise<void> {
    await this.stubPost(scanUrls.googleBooksConfigured, configured);
  }

  /** Accepts a check-in without writing it, for books other specs read. */
  async stubCheckIn(bookUuid: string): Promise<void> {
    await this.stubPost(scanUrls.checkIn, { book_uuid: bookUuid });
  }

  /** Accepts a wishlist entry without writing it. */
  async stubWishlistEntry(bookUuid: string): Promise<void> {
    await this.stubPost(scanUrls.wishlist, { book_uuid: bookUuid });
  }

  /** Fails every request `contract` describes from this page with a 500. */
  async forceServerError(contract: ExpectMutationOptions): Promise<void> {
    await this.page.route(contract.url, (route) =>
      route.request().method() === contract.method
        ? route.fulfill({
            status: 500,
            contentType: "text/plain",
            body: "forced failure",
          })
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

  async lookUpIsbn(isbn: string): Promise<void> {
    await this.enterIsbn(isbn);
    await this.findBook();
  }

  async searchByTitle(query: string): Promise<void> {
    await this.titleField.fill(query);
    const searched = this.page.waitForResponse(isPostTo(scanUrls.search));
    await this.searchButton.click();
    await searched;
  }

  async pickSearchResult(title: string): Promise<void> {
    const picked = this.page.waitForResponse(isPostTo(scanUrls.resolveMeta));
    await this.searchResultButton(title).click();
    await picked;
  }

  async openScanner(): Promise<void> {
    await this.scanBarcodeButton.click();
  }

  async enterIsbnInstead(): Promise<void> {
    await this.enterIsbnInsteadButton.click();
  }

  async openTitleSearch(): Promise<void> {
    await this.searchByTitleButton.click();
  }

  async searchByTitleInstead(): Promise<void> {
    await this.searchByTitleInsteadButton.click();
  }

  async typeOnKeypad(digits: string): Promise<void> {
    for (const digit of digits) {
      await this.keypadButton(digit).click();
    }
  }

  async deleteLastDigit(): Promise<void> {
    await this.keypadButton("Delete").click();
  }

  async enterNote(note: string): Promise<void> {
    await this.noteField.fill(note);
  }

  async checkInCopy(): Promise<void> {
    const checkedIn = this.page.waitForResponse(isPostTo(scanUrls.checkIn));
    await this.checkInButton.click();
    await checkedIn;
  }

  async cancelConfirmation(): Promise<void> {
    await this.cancelButton.click();
  }

  async pickCloseMatch(title: string): Promise<void> {
    await this.closeMatchPickButton(title).click();
  }

  async declineCloseMatch(): Promise<void> {
    await this.declineCloseMatchButton.click();
  }

  /** "I own it": adds the looked-up book with its first copy. */
  async addToCollection(): Promise<void> {
    const added = this.page.waitForResponse(isPostTo(scanUrls.physicalOnly));
    await this.ownItButton.click();
    await added;
  }

  async addToWishlist(): Promise<void> {
    const added = this.page.waitForResponse(isPostTo(scanUrls.wishlist));
    await this.addToWishlistButton.click();
    await added;
  }

  async openLinkPicker(): Promise<void> {
    await this.linkExistingButton.click();
  }

  async searchLibrary(query: string): Promise<void> {
    await this.libraryQueryField.fill(query);
    const searched = this.page.waitForResponse(isPostTo(paletteUrls.search));
    await this.searchLibraryButton.click();
    await searched;
  }

  async pickLinkResult(title: string): Promise<void> {
    await this.linkPickButton(title).click();
  }

  async backToChooser(): Promise<void> {
    await this.linkBackButton.click();
  }

  async viewBook(): Promise<void> {
    await this.viewBookLink.click();
  }

  /** Leaves the flow through its own × link, back to the library. */
  async cancelCheckIn(): Promise<void> {
    await this.cancelLink.click();
  }

  private titleText(title: string): Locator {
    return this.page.getByText(title, { exact: true });
  }

  /** A picker row: a library book's card beside its own pick button. */
  private pickerRow(list: Locator, title: string): Locator {
    return list.getByRole("listitem").filter({ has: this.titleText(title) });
  }

  private async stubPost(url: RegExp, json: unknown): Promise<void> {
    await this.page.route(url, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json })
        : route.continue(),
    );
  }
}

import type { Locator, Page, Request } from "@playwright/test";
import { journalsUrls } from "../contracts/journals";
import { reviewsUrls } from "../contracts/reviews";
import { holdRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

const isMethod = (method: string) => (request: Request) =>
  request.method() === method;

/**
 * The book page's Reviews tab: your review card and its composer, and the
 * other readers' reviews; plus the hero's household average, which opens the tab.
 */
export class ReviewsComponent extends BaseComponent {
  readonly section: Locator;

  /** The hero's household average, shown once enough readers rated. */
  readonly summary: Locator;
  /** The average's stars, named "3.5 out of 5 stars". */
  readonly summaryAverage: Locator;
  /** The average's count, "2 reviews", which opens the Reviews tab. */
  readonly jumpLink: Locator;

  readonly myReview: Locator;
  readonly starsGroup: Locator;
  /** The line beside your stars; the hero's stars have one too. */
  readonly starsMeta: Locator;
  readonly myText: Locator;
  readonly myNotes: Locator;
  /** Any checkbox on your card, to show read mode carries none. */
  readonly myReviewCheckboxes: Locator;
  /** The pencil; its name reads Write review or Edit review with the card's state. */
  readonly writeButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  readonly deleteError: Locator;
  private readonly confirmDeleteButton: Locator;

  readonly composer: Locator;
  /** The review text's field: its toolbar and its editor, inert while a save is out. */
  readonly textField: Locator;
  readonly notesField: Locator;
  readonly textEditor: Locator;
  private readonly textHighlightsButton: Locator;
  readonly textHighlightsPopover: Locator;
  private readonly textImageInput: Locator;
  readonly notesEditor: Locator;
  readonly spoilerCheckbox: Locator;
  readonly composerError: Locator;
  readonly cancelButton: Locator;
  readonly saveButton: Locator;

  readonly otherReviewCards: Locator;
  readonly otherReviewText: Locator;
  readonly spoilerVeil: Locator;
  private readonly revealSpoilerButton: Locator;
  readonly noOtherReviewsMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.section = page.getByTestId("reviews-section");

    this.summary = page.getByRole("group", { name: "Household average" });
    this.summaryAverage = this.summary.getByRole("img");
    this.jumpLink = this.summary.getByRole("button");

    this.myReview = page.getByRole("region", { name: "Your review" });
    this.starsGroup = this.myReview.getByRole("group", { name: "Your rating" });
    this.starsMeta = this.myReview.getByTestId("review-stars-meta");
    this.myText = page.getByTestId("my-review-text");
    this.myNotes = page.getByTestId("my-review-notes");
    this.myReviewCheckboxes = this.myReview.getByRole("checkbox");
    this.writeButton = page.getByTestId("review-write");
    this.deleteButton = page.getByTestId("review-delete");
    this.deleteDialog = page.getByRole("dialog", {
      name: "Delete your review?",
    });
    this.deleteError = this.deleteDialog.getByRole("alert");
    this.confirmDeleteButton = this.deleteDialog.getByRole("button", {
      name: "Delete",
      exact: true,
    });

    this.composer = page.getByTestId("review-composer");
    this.textField = this.composer.getByTestId("review-body-field");
    this.notesField = this.composer.getByTestId("review-notes-field");
    this.textHighlightsButton = this.textField.getByRole("button", {
      name: "From highlights",
    });
    this.textHighlightsPopover = this.textField.getByTestId(
      "journal-highlights-pop",
    );
    this.textImageInput = this.textField.getByTestId("journal-image-input");
    this.textEditor = this.composer.getByRole("textbox", {
      name: "Review text",
    });
    this.notesEditor = this.composer.getByRole("textbox", {
      name: "Private notes",
    });
    this.spoilerCheckbox = this.composer.getByRole("checkbox", {
      name: "Contains spoilers",
    });
    this.composerError = this.composer.getByRole("alert");
    this.cancelButton = this.composer.getByRole("button", { name: "Cancel" });
    // Its label turns to "Saving…" while a save is out.
    this.saveButton = this.composer.getByTestId("review-save");

    this.otherReviewCards = page.getByTestId("review-card");
    this.otherReviewText = this.otherReviewCards.getByTestId("review-text");
    this.spoilerVeil = page.getByTestId("review-spoiler-veil");
    this.revealSpoilerButton = page.getByRole("button", {
      name: "Show review",
    });
    this.noOtherReviewsMessage = this.section.getByRole("heading", {
      name: "No ratings or reviews yet",
    });
  }

  rateButton(stars: number): Locator {
    return this.starsGroup.getByRole("button", {
      name: stars === 1 ? "Rate 1 star" : `Rate ${stars} stars`,
      exact: true,
    });
  }

  /** The half star that holds the current rating; clicking it clears the stars. */
  clearButton(stars: number): Locator {
    return this.starsGroup.getByRole("button", {
      name: `Clear your ${stars}-star rating`,
      exact: true,
    });
  }

  /** A star row anywhere in the tab, by its label: "4.5 out of 5 stars". */
  starsLabelled(label: string): Locator {
    return this.section.getByLabel(label, { exact: true });
  }

  /** Text anywhere in the tab, to show what is drawn and what is not. */
  textInSection(text: string): Locator {
    return this.section.getByText(text);
  }

  async rate(stars: number): Promise<void> {
    await this.rateButton(stars).click();
  }

  async clear(stars: number): Promise<void> {
    await this.clearButton(stars).click();
  }

  async openComposer(): Promise<void> {
    await this.writeButton.click();
  }

  async writeText(text: string): Promise<void> {
    await this.textEditor.fill(text);
  }

  async writeNotes(text: string): Promise<void> {
    await this.notesEditor.fill(text);
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  /** Picks `png` in the review text's image tool, which uploads it. */
  async uploadTextImage(png: Buffer): Promise<void> {
    await this.textImageInput.setInputFiles({
      name: "figure.png",
      mimeType: "image/png",
      buffer: png,
    });
  }

  async openTextHighlights(): Promise<void> {
    await this.textHighlightsButton.click();
  }

  async pressEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async toggleSpoiler(): Promise<void> {
    await this.spoilerCheckbox.click();
  }

  async openDeleteDialog(): Promise<void> {
    await this.deleteButton.click();
  }

  async confirmDelete(): Promise<void> {
    await this.confirmDeleteButton.click();
  }

  async revealSpoiler(): Promise<void> {
    await this.revealSpoilerButton.click();
  }

  async jumpToReviews(): Promise<void> {
    await this.jumpLink.click();
  }

  /** Holds every later review save until the returned release runs. */
  async holdReviewSaves(): Promise<() => void> {
    return holdRequests(this.page, reviewsUrls.review, isMethod("PATCH"));
  }

  /**
   * Holds every later review save until the returned release runs, then
   * refuses it with a 500: a refusal timed after something else happens.
   */
  async holdThenRefuseReviewSaves(): Promise<() => void> {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await this.page.route(reviewsUrls.review, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      });
    });
    return release;
  }

  /** Lets review saves through again after a hold or a forced refusal. */
  async stopHoldingReviewSaves(): Promise<void> {
    await this.page.unroute(reviewsUrls.review);
  }

  /** Holds every later image upload until the returned release runs. */
  async holdImageUploads(): Promise<() => void> {
    return holdRequests(this.page, journalsUrls.images);
  }

  /** Holds every later read of the book's reviews until the returned release runs. */
  async holdReviewsRead(): Promise<() => void> {
    return holdRequests(this.page, reviewsUrls.review, isMethod("GET"));
  }
}

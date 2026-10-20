import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/**
 * The book page's Reviews stop: your review card and its composer, the
 * household summary, the other readers' reviews, and the title area's jump in.
 */
export class ReviewsComponent extends BaseComponent {
  readonly section: Locator;
  readonly kicker: Locator;
  readonly jumpLink: Locator;

  readonly myReview: Locator;
  readonly starsGroup: Locator;
  /** The line beside your stars; another status line shares the page. */
  readonly starsMeta: Locator;
  readonly myText: Locator;
  readonly myNotes: Locator;
  /** Any checkbox on your card, to show read mode carries none. */
  readonly myReviewCheckboxes: Locator;
  /** The pencil; its name reads Write review or Edit review with the card's state. */
  readonly writeButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  private readonly confirmDeleteButton: Locator;

  readonly composer: Locator;
  readonly textEditor: Locator;
  readonly notesEditor: Locator;
  readonly spoilerCheckbox: Locator;
  readonly composerError: Locator;
  private readonly saveButton: Locator;

  readonly summary: Locator;
  readonly summaryAverage: Locator;
  readonly summaryCount: Locator;
  readonly otherReviewCards: Locator;
  readonly otherReviewText: Locator;
  readonly spoilerVeil: Locator;
  private readonly revealSpoilerButton: Locator;
  readonly starsOnlyRow: Locator;
  readonly starsOnlyItems: Locator;
  readonly noOtherReviewsMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.section = page.getByTestId("reviews-section");
    this.kicker = page.getByTestId("reviews-kicker");
    this.jumpLink = page.getByRole("button", { name: /go to the reviews$/ });

    this.myReview = page.getByRole("region", { name: "Your review" });
    this.starsGroup = this.myReview.getByRole("group", { name: "Your rating" });
    this.starsMeta = page.getByTestId("review-stars-meta");
    this.myText = page.getByTestId("my-review-text");
    this.myNotes = page.getByTestId("my-review-notes");
    this.myReviewCheckboxes = this.myReview.getByRole("checkbox");
    this.writeButton = page.getByTestId("review-write");
    this.deleteButton = this.myReview.getByRole("button", {
      name: "Delete review",
    });
    this.deleteDialog = page.getByRole("dialog", {
      name: "Delete your review?",
    });
    this.confirmDeleteButton = this.deleteDialog.getByRole("button", {
      name: "Delete",
      exact: true,
    });

    this.composer = page.getByTestId("review-composer");
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
    this.saveButton = this.composer.getByRole("button", {
      name: "Save review",
    });

    this.summary = page.getByTestId("review-summary");
    this.summaryAverage = page.getByTestId("review-summary-average");
    this.summaryCount = page.getByTestId("review-summary-count");
    this.otherReviewCards = page.getByTestId("review-card");
    this.otherReviewText = this.otherReviewCards.getByTestId("review-text");
    this.spoilerVeil = page.getByTestId("review-spoiler-veil");
    this.revealSpoilerButton = page.getByRole("button", {
      name: "Show review",
    });
    this.starsOnlyRow = page.getByTestId("review-stars-only");
    this.starsOnlyItems = this.starsOnlyRow.getByRole("listitem");
    this.noOtherReviewsMessage = page.getByTestId("other-reviews-empty");
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

  /** A star row anywhere in the section, by its label: "4.5 out of 5 stars". */
  starsLabelled(label: string): Locator {
    return this.section.getByLabel(label, { exact: true });
  }

  /** Text anywhere in the section, to show what is drawn and what is not. */
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
}

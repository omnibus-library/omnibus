import type { Locator, Page } from "@playwright/test";
import { AddBooksModalComponent } from "../components/AddBooksModalComponent";
import { EditShelfModalComponent } from "../components/EditShelfModalComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";
import { ShelvesIndexPage } from "./ShelvesIndexPage";

/** A single shelf at `/shelves/:id`, reached from the `/shelves` index. */
export class ShelfPage extends BasePage {
  protected readonly urlPattern = /\/shelves\/\d+$/;

  readonly topNav: TopNavComponent;
  readonly addBooksModal: AddBooksModalComponent;
  readonly editShelfModal: EditShelfModalComponent;

  readonly titleHeading: Locator;
  readonly kickerText: Locator;
  readonly ownerBadge: Locator;
  readonly ownerName: Locator;
  readonly adminNote: Locator;
  readonly backLink: Locator;
  readonly addBooksButton: Locator;
  readonly editButton: Locator;
  readonly moreButton: Locator;
  readonly lockNote: Locator;
  readonly bookGrid: Locator;
  readonly emptyMessage: Locator;
  readonly removeError: Locator;
  readonly rulesSummary: Locator;
  readonly sortSelect: Locator;
  readonly koboSyncToggle: Locator;
  readonly koboBadge: Locator;
  readonly deleteMenuItem: Locator;
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteError: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.addBooksModal = new AddBooksModalComponent(page);
    this.editShelfModal = new EditShelfModalComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.kickerText = page.getByTestId("shelf-kicker");
    this.ownerBadge = page.getByTestId("shelf-owner");
    this.ownerName = page.getByTestId("shelf-owner-name");
    this.adminNote = page.getByTestId("shelf-admin-note");
    this.backLink = page.getByTestId("shelf-back");
    this.addBooksButton = page.getByTestId("shelf-add-books");
    this.editButton = page.getByTestId("shelf-edit");
    this.moreButton = page.getByTestId("shelf-actions");
    this.lockNote = page.getByTestId("shelf-lock-reason");
    this.bookGrid = page.getByTestId("shelf-grid");
    this.emptyMessage = page.getByTestId("shelf-empty");
    this.removeError = page.getByTestId("shelf-remove-error");
    this.rulesSummary = page.getByTestId("shelf-rules");
    this.sortSelect = page.getByTestId("shelf-sort");
    this.koboSyncToggle = page.getByRole("menuitemcheckbox", {
      name: "Sync to Kobo",
    });
    this.koboBadge = page.getByTestId("shelf-kobo-badge");
    this.deleteMenuItem = page.getByTestId("shelf-delete");
    this.deleteDialog = page.getByTestId("shelf-delete-modal");
    this.deleteConfirmButton = page.getByTestId("shelf-delete-confirm");
    this.deleteError = page.getByTestId("shelf-delete-error");
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** The shelf's title, found by name. */
  heading(name: string): Locator {
    return this.page.getByRole("heading", { level: 1, name });
  }

  /** A book's grid tile, a `listitem` and not a link (`landing/grid.rs`). */
  bookTile(title: string): Locator {
    return this.page.getByRole("listitem", {
      name: `Open details for ${title}`,
    });
  }

  /** The button that takes a book off a hand-picked shelf. */
  removeButton(bookTitle: string): Locator {
    return this.page.getByRole("button", {
      name: `Remove ${bookTitle} from this shelf`,
    });
  }

  /** Opens the shelf from the `/shelves` index, as a reader does. */
  async goto(shelfId: number): Promise<void> {
    const index = new ShelvesIndexPage(this.page);
    await index.goto();
    await index.openShelf(shelfId);
    await this.page.waitForURL(new RegExp(`/shelves/${shelfId}$`));
  }

  /** The shelf's owner as the page names them. */
  async ownerLabel(): Promise<string | undefined> {
    return (await this.ownerName.textContent())?.trim();
  }

  async openBook(title: string): Promise<void> {
    await this.bookTile(title).click();
  }

  async openAddBooks(): Promise<void> {
    await this.addBooksButton.click();
  }

  /** Presses Add books while it is greyed, to show it is inert. */
  async openAddBooksAnyway(): Promise<void> {
    await this.addBooksButton.click({ force: true });
  }

  async openEditShelf(): Promise<void> {
    await this.editButton.click();
  }

  /** Presses Edit shelf while it is greyed, to show it is inert. */
  async openEditShelfAnyway(): Promise<void> {
    await this.editButton.click({ force: true });
  }

  async removeBook(bookTitle: string): Promise<void> {
    await this.removeButton(bookTitle).click();
  }

  async openMenu(): Promise<void> {
    await this.moreButton.click();
  }

  /** Flips Sync to Kobo, which the open More menu offers. */
  async toggleKoboSync(): Promise<void> {
    await this.koboSyncToggle.click();
  }

  /** Opens the More menu and asks to delete the shelf. */
  async openDeleteDialog(): Promise<void> {
    await this.openMenu();
    await this.deleteMenuItem.click();
  }

  async confirmDelete(): Promise<void> {
    await this.deleteConfirmButton.click();
  }

  async sortBy(order: string): Promise<void> {
    await this.sortSelect.selectOption(order);
  }

  /** Checks the page is showing shelf `shelfId`, not just any shelf. */
  async assertDisplayedFor(shelfId: number): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/shelves/${shelfId}$`));
    await expect(this.titleHeading).toBeVisible();
  }

  // #region batch-H: filters and book-detail shelves
  // #endregion batch-H
}

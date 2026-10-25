import type { Locator, Page } from "@playwright/test";
import { AddBooksModalComponent } from "../components/AddBooksModalComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { EditShelfModalComponent } from "../components/EditShelfModalComponent";
import { FilterBarComponent } from "../components/FilterBarComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { shelvesUrls, unfilteredShelfRead } from "../contracts/shelves";
import { expect } from "../fixtures/test";
import { isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";
import { ShelvesIndexPage } from "./ShelvesIndexPage";

/** A single shelf at `/shelves/:id`, reached from the `/shelves` index. */
export class ShelfPage extends BasePage {
  protected readonly urlPattern = /\/shelves\/\d+$/;

  readonly topNav: TopNavComponent;
  readonly addBooksModal: AddBooksModalComponent;
  readonly checkInOverlay: CheckInOverlayComponent;
  readonly editShelfModal: EditShelfModalComponent;
  readonly filterBar: FilterBarComponent;

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
  readonly count: Locator;
  readonly countPending: Locator;
  readonly loading: Locator;
  readonly filteredEmptyMessage: Locator;
  readonly refetchError: Locator;
  readonly clearFiltersButton: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.addBooksModal = new AddBooksModalComponent(page);
    this.checkInOverlay = new CheckInOverlayComponent(page);
    this.editShelfModal = new EditShelfModalComponent(page);
    this.filterBar = new FilterBarComponent(page);
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
    this.count = page.getByTestId("shelf-count");
    this.countPending = page.getByTestId("shelf-count-pending");
    this.loading = page.getByTestId("shelf-loading");
    this.filteredEmptyMessage = page.getByTestId("shelf-filtered-empty");
    this.refetchError = page.getByTestId("shelf-refetch-error");
    this.clearFiltersButton = page.getByRole("button", {
      name: "Clear filters",
    });
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

  /** The button on a member's tile that takes it off a hand-picked shelf. */
  removeButton(bookUuid: string): Locator {
    return this.page.getByTestId(`shelf-remove-${bookUuid}`);
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

  async removeBook(bookUuid: string): Promise<void> {
    await this.removeButton(bookUuid).click();
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

  async clearFilters(): Promise<void> {
    await this.clearFiltersButton.click();
  }

  /** Takes the book off and waits for the unfiltered member list it re-reads. */
  async removeMember(bookUuid: string): Promise<void> {
    const isShelfRead = isPostTo(shelvesUrls.page);
    const reread = this.page.waitForResponse(
      (response) =>
        isShelfRead(response) && unfilteredShelfRead(response.request()),
    );
    await this.removeButton(bookUuid).click();
    await reread;
  }

  /** The member titles on the grid, sorted. */
  async memberTitles(): Promise<string[]> {
    return this.page
      .getByTestId("shelf-tile")
      .evaluateAll((tiles) =>
        tiles
          .map((t) =>
            (t.getAttribute("aria-label") ?? "").replace(
              /^Open details for /,
              "",
            ),
          )
          .sort(),
      );
  }

  /** Records whether a member's remove button is disabled on each DOM change. */
  async recordRemoveButtonStates(bookUuid: string): Promise<void> {
    await this.page.evaluate((id) => {
      const seen: boolean[] = [];
      let started = false;
      Object.assign(window, { __removeButtonStates: seen });
      new MutationObserver(() => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-testid="shelf-remove-${id}"]`,
        );
        if (!button) return;
        started ||= button.disabled;
        if (started) seen.push(button.disabled);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    }, bookUuid);
  }

  /** The states `recordRemoveButtonStates` saw from the first disabled paint. */
  async removeButtonStates(): Promise<boolean[]> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __removeButtonStates: boolean[] })
          .__removeButtonStates,
    );
  }

  /** Checks the page is showing shelf `shelfId`, not just any shelf. */
  async assertDisplayedFor(shelfId: number): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`/shelves/${shelfId}$`));
  }

  /** Checks the grid shows exactly these members and the count says so. */
  async assertShowsMembers(titles: string[]): Promise<void> {
    await expect
      .poll(() => this.memberTitles(), { message: "tiles on the shelf page" })
      .toEqual([...titles].sort());
    await expect(this.count).toHaveText(String(titles.length));
  }
}

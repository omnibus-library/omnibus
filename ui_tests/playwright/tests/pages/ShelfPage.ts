import type { Locator, Page } from "@playwright/test";
import { FilterBarComponent } from "../components/FilterBarComponent";
import { shelvesUrls } from "../contracts/shelves";
import { expect } from "../fixtures/test";
import { isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";

export class ShelfPage extends BasePage {
  protected readonly urlPattern = /\/shelves\/\d+$/;

  readonly titleHeading: Locator;

  constructor(page: Page) {
    super(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** A book's grid tile, a `listitem` and not a link (`landing/grid.rs`). */
  bookTile(title: string): Locator {
    return this.page.getByRole("listitem", {
      name: `Open details for ${title}`,
    });
  }

  /** Opens the shelf from the `/shelves` index, as a reader does. */
  async goto(shelfId: number): Promise<void> {
    await this.open("/shelves");
    await this.shelfCard(shelfId).click();
    await this.page.waitForURL(new RegExp(`/shelves/${shelfId}$`));
  }

  /** The shelf's card on the `/shelves` index. */
  private shelfCard(shelfId: number): Locator {
    return this.page.getByTestId(`shelf-card-${shelfId}`);
  }

  // #region batch-H: filters and book-detail shelves
  readonly filterBar = new FilterBarComponent(this.page);

  readonly count = this.page.getByTestId("shelf-count");
  readonly countPending = this.page.getByTestId("shelf-count-pending");
  readonly loading = this.page.getByTestId("shelf-loading");
  readonly emptyMessage = this.page.getByTestId("shelf-empty");
  readonly filteredEmptyMessage = this.page.getByTestId("shelf-filtered-empty");
  readonly refetchError = this.page.getByTestId("shelf-refetch-error");
  readonly clearFiltersButton = this.page.getByRole("button", {
    name: "Clear filters",
  });

  private heldReads = 0;
  private releaseHeldReads = () => {};

  /** The button on a member's tile that takes it off the shelf. */
  removeButton(bookUuid: string): Locator {
    return this.page.getByTestId(`shelf-remove-${bookUuid}`);
  }

  async clearFilters(): Promise<void> {
    await this.clearFiltersButton.click();
  }

  /** Takes the book off and waits for the unfiltered member list it re-reads. */
  async removeMember(bookUuid: string): Promise<void> {
    const isShelfRead = isPostTo(shelvesUrls.page);
    const reread = this.page.waitForResponse(
      (response) =>
        isShelfRead(response) &&
        response.request().postDataJSON().filters.clauses.length === 0,
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

  /** Checks the grid shows exactly these members and the count says so. */
  async assertShowsMembers(titles: string[]): Promise<void> {
    await expect
      .poll(() => this.memberTitles(), { message: "tiles on the shelf page" })
      .toEqual([...titles].sort());
    await expect(this.count).toHaveText(String(titles.length));
  }

  /** Answers 500 to member reads that carry a filter; the rest go through. */
  async failFilteredShelfReads(): Promise<void> {
    await this.failShelfReadsWhere((clauses) => clauses > 0);
  }

  /** Answers 500 to the member read with no filter; the rest go through. */
  async failUnfilteredShelfReads(): Promise<void> {
    await this.failShelfReadsWhere((clauses) => clauses === 0);
  }

  /** Lets member reads through again after a `fail*ShelfReads` stub. */
  async restoreShelfReads(): Promise<void> {
    await this.page.unroute(shelvesUrls.page);
  }

  /** Parks the member reads that carry exactly `clauses` filter clauses. */
  async holdShelfReads(clauses: number): Promise<void> {
    this.heldReads = 0;
    const gate = new Promise<void>((resolve) => {
      this.releaseHeldReads = resolve;
    });
    await this.page.route(shelvesUrls.page, async (route) => {
      const { filters } = route.request().postDataJSON();
      if (filters.clauses.length === clauses) {
        this.heldReads += 1;
        await gate;
      }
      await route.continue();
    });
  }

  /** How many parked reads have reached the route. */
  heldShelfReads(): number {
    return this.heldReads;
  }

  /** Lets the parked reads through and drops every route on the page. */
  async releaseShelfReads(): Promise<void> {
    this.releaseHeldReads();
    await this.page.unrouteAll({ behavior: "wait" });
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

  private async failShelfReadsWhere(
    fails: (clauses: number) => boolean,
  ): Promise<void> {
    await this.page.route(shelvesUrls.page, async (route) => {
      const { filters } = route.request().postDataJSON();
      if (fails(filters.clauses.length)) {
        await route.fulfill({ status: 500, body: "boom" });
      } else {
        await route.continue();
      }
    });
  }
  // #endregion batch-H
}

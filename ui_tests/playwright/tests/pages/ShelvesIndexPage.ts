import type { Locator, Page } from "@playwright/test";
import { CreateShelfModalComponent } from "../components/CreateShelfModalComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { shelvesUrls } from "../contracts/shelves";
import { BasePage } from "./BasePage";

/** `/shelves`: every shelf the viewer can see, grouped by owner. */
export class ShelvesIndexPage extends BasePage {
  protected readonly urlPattern = /\/shelves$/;

  readonly topNav: TopNavComponent;
  readonly createShelfModal: CreateShelfModalComponent;

  readonly titleHeading: Locator;
  readonly indexRoot: Locator;
  readonly census: Locator;
  readonly newShelfButton: Locator;
  readonly filterField: Locator;
  readonly emptyMessage: Locator;
  readonly clearFiltersButton: Locator;
  readonly wishlistKindButton: Locator;
  readonly handPickedKindButton: Locator;
  readonly sortBySizeButton: Locator;
  readonly everyoneChip: Locator;
  readonly shelfGroups: Locator;
  readonly shelfCards: Locator;
  readonly firstShelfCard: Locator;
  readonly firstGroupHeading: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.createShelfModal = new CreateShelfModalComponent(page);
    this.titleHeading = page.getByRole("heading", {
      level: 1,
      name: "Shelves",
    });
    this.indexRoot = page.getByTestId("shelves-index");
    this.census = page.getByTestId("shelves-census");
    this.newShelfButton = page.getByTestId("new-shelf");
    this.filterField = page.getByLabel("Filter shelves by name or owner");
    this.emptyMessage = page.getByTestId("shelves-empty");
    this.clearFiltersButton = page.getByTestId("shelves-clear-filters");
    this.wishlistKindButton = page.getByTestId("shelves-kind-wishlist");
    this.handPickedKindButton = page.getByTestId("shelves-kind-manual");
    this.sortBySizeButton = page.getByTestId("shelves-sort-count");
    this.everyoneChip = page.getByTestId("shelves-owner-anyone");
    this.shelfGroups = page.getByTestId(/^shelves-group-\d+$/);
    this.shelfCards = page.getByTestId(/^shelf-card-\d+$/);
    this.firstShelfCard = this.shelfCards.first();
    this.firstGroupHeading = this.shelfGroups.first().getByRole("heading");
    this.errorAlert = page.getByRole("alert");
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** A shelf's card, found by its id. */
  shelfCard(shelfId: number): Locator {
    return this.page.getByTestId(`shelf-card-${shelfId}`);
  }

  /** The group of shelves one owner holds. */
  ownerGroup(ownerId: number): Locator {
    return this.page.getByTestId(`shelves-group-${ownerId}`);
  }

  /** The title of one owner's group, which names the owner. */
  ownerGroupHeading(ownerId: number): Locator {
    return this.ownerGroup(ownerId).getByRole("heading");
  }

  /** The owner chip that narrows the list to one reader. */
  ownerChip(ownerId: number): Locator {
    return this.page.getByTestId(`shelves-owner-${ownerId}`);
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/shelves");
  }

  /** Opens the index when its list fails, which draws an alert and no page. */
  async gotoUnavailable(): Promise<void> {
    await this.page.goto("/shelves");
  }

  /** Answers the shelf list with a 500, whatever the app asks for. */
  async stubShelfListError(): Promise<void> {
    await this.page.route(shelvesUrls.list, (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
  }

  async openShelf(shelfId: number): Promise<void> {
    await this.shelfCard(shelfId).click();
  }

  async openNewShelf(): Promise<void> {
    await this.newShelfButton.click();
  }

  async filterBy(text: string): Promise<void> {
    await this.filterField.fill(text);
  }

  async clearFilters(): Promise<void> {
    await this.clearFiltersButton.click();
  }

  async narrowToWishlists(): Promise<void> {
    await this.wishlistKindButton.click();
  }

  async narrowToHandPicked(): Promise<void> {
    await this.handPickedKindButton.click();
  }

  async sortBySize(): Promise<void> {
    await this.sortBySizeButton.click();
  }

  async pickOwner(ownerId: number): Promise<void> {
    await this.ownerChip(ownerId).click();
  }

  /** The ids of the shelves showing, in the order they are drawn. */
  async shelfIds(): Promise<number[]> {
    const testIds = await this.shelfCards.evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-testid") ?? ""),
    );
    return testIds.map((testId) => Number(testId.replace("shelf-card-", "")));
  }

  groupCount(): Promise<number> {
    return this.shelfGroups.count();
  }
}

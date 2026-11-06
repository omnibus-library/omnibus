import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** Every reader's book requests at `/requests`: one item per book, grouped by where it stands, beside the selected book's request. */
export class RequestsPage extends BasePage {
  // The page names the selected book in the address once it opens.
  protected readonly urlPattern = /\/requests(\?book=[^&#]+)?$/;

  readonly topNav: TopNavComponent;

  readonly root: Locator;
  readonly heading: Locator;
  readonly items: Locator;
  /** The selected book's request, beside the list. */
  readonly pane: Locator;
  /** The pane's lane for the request its book is filed under, not another reader's beside it. */
  readonly paneLane: Locator;
  readonly paneState: Locator;
  /** Who asked for the selected book's request, and when. */
  readonly paneRequester: Locator;
  readonly paneCancelButton: Locator;
  readonly cancelFailedText: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.root = page.getByTestId("requests-page");
    this.heading = page.getByRole("heading", { level: 1, name: "Requests" });
    this.items = page.getByTestId("requests-item");
    this.pane = page.getByTestId("requests-pane");
    this.paneLane = this.pane.getByTestId("request-lane-ebook");
    this.paneState = this.paneLane.getByTestId("request-state");
    this.paneRequester = this.paneLane.getByTestId("request-requester");
    this.paneCancelButton = this.paneLane.getByTestId("request-cancel");
    this.cancelFailedText = page.getByText(/Couldn’t cancel/);
  }

  protected get readyLocator(): Locator {
    return this.root;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/requests");
  }

  /** The item for the book called `title`. */
  item(title: string): Locator {
    return this.items.filter({
      has: this.page.getByText(title, { exact: true }),
    });
  }

  /** The item for `title` under the group labelled `group`, such as "Looking". */
  itemIn(group: string, title: string): Locator {
    return this.page
      .getByRole("region", { name: group, exact: true })
      .getByTestId("requests-item")
      .filter({ has: this.page.getByText(title, { exact: true }) });
  }

  /** Shows `title`'s request in the pane. */
  async select(title: string): Promise<void> {
    await this.item(title).click();
  }

  async cancel(): Promise<void> {
    await this.paneCancelButton.click();
  }
}

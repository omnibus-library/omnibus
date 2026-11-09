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
  /** The pane's lane for the request its book is filed under, whichever format, not another reader's beside it. */
  readonly paneLane: Locator;
  /** The selected book's title, the pane's h2. */
  readonly paneTitle: Locator;
  /** The lane's state in words, such as Looking, On its way, Ready to read or Ready to listen. */
  readonly paneState: Locator;
  /** Who asked for the selected book's request, and when. */
  readonly paneRequester: Locator;
  readonly paneCancelButton: Locator;
  readonly looking: Locator;
  readonly versions: Locator;
  /** The Choose buttons on the versions, none for a reader who can't pick versions. */
  readonly chooseButtons: Locator;
  /** The line a reader who can't pick versions sees in place of the Choose buttons. */
  readonly waitingForChooser: Locator;
  readonly bestMatchBadges: Locator;
  readonly chosen: Locator;
  /** The download's percent, once the client has reported. */
  readonly percent: Locator;
  readonly tryAgain: Locator;
  /** The error a stuck request names, in plain words; every reader sees it. */
  readonly stuckDetail: Locator;
  readonly cancelFailedText: Locator;
  /** The header's Request button, which opens the search for a book to request. */
  readonly addButton: Locator;
  /** The search's field, once its panel is open. */
  readonly addSearchField: Locator;
  readonly addPanel: Locator;
  readonly startFailedText: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.root = page.getByTestId("requests-page");
    this.heading = page.getByRole("heading", { level: 1, name: "Requests" });
    this.items = page.getByTestId("requests-item");
    this.pane = page.getByTestId("requests-pane");
    this.paneLane = this.pane.getByTestId(/^request-lane-/);
    this.paneTitle = this.pane.getByRole("heading", { level: 2 });
    this.paneState = this.paneLane.getByTestId("request-state");
    this.paneRequester = this.paneLane.getByTestId("request-requester");
    this.paneCancelButton = this.paneLane.getByTestId("request-cancel");
    this.looking = this.paneLane.getByTestId("request-looking");
    this.versions = this.paneLane.getByTestId("request-version");
    this.chooseButtons = this.versions.getByTestId("request-choose");
    this.waitingForChooser = this.paneLane.getByTestId(
      "request-waiting-for-chooser",
    );
    this.bestMatchBadges = this.paneLane.getByTestId("request-best-match");
    this.chosen = this.paneLane.getByTestId("request-chosen");
    this.percent = this.paneLane.getByTestId("request-percent");
    this.tryAgain = this.paneLane.getByRole("button", { name: "Try again" });
    this.stuckDetail = this.paneLane.getByTestId("request-stuck-detail");
    this.cancelFailedText = page.getByText(/Couldn’t cancel/);
    this.addButton = page.getByTestId("requests-add");
    this.addPanel = page.getByTestId("requests-add-panel");
    this.startFailedText = page.getByText("Couldn’t start the request.");
    this.addSearchField = this.addPanel.getByRole("searchbox", {
      name: "Title, author or ISBN",
    });
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

  /** The header button of the group labelled `group` while the group is open; none when folded or absent. */
  openGroupToggle(group: string): Locator {
    return this.page
      .getByRole("region", { name: group, exact: true })
      .getByRole("button", { expanded: true });
  }

  /** Shows `title`'s request in the pane. */
  async select(title: string): Promise<void> {
    await this.item(title).click();
  }

  /** Checks the page is showing `uuid`'s book, as its address says. */
  async assertSelected(uuid: string): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`/requests\\?book=${uuid}$`));
  }

  /** Searches the header's Request panel for `title` and starts an ebook request on the library book it finds. */
  async requestFromSearch(title: string): Promise<void> {
    await this.addButton.click();
    await this.addSearchField.fill(title);
    await this.addPanel
      .getByRole("button", { name: `Request ${title}`, exact: true })
      .click();
  }

  async cancel(): Promise<void> {
    await this.paneCancelButton.click();
  }

  /** The version row in `format`, such as `EPUB`, read from its source line. */
  version(format: string): Locator {
    const escaped = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.versions.filter({
      has: this.page
        .getByTestId("request-version-meta")
        .filter({ hasText: new RegExp(`(^|\\s·\\s)${escaped}\\s·\\s`) }),
    });
  }

  /** The Best match badge on `version`'s row. */
  bestMatchOf(version: Locator): Locator {
    return version.getByTestId("request-best-match");
  }

  /** The link that opens `version`'s source page. */
  pageLinkOf(version: Locator): Locator {
    return version.getByRole("link");
  }

  async choose(version: Locator): Promise<void> {
    await version.getByTestId("request-choose").click();
  }
}

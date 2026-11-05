import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** A book's request page at `/books/{uuid}/request?id=`. */
export class BookRequestPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+\/request\?id=\d+$/;

  readonly topNav: TopNavComponent;

  readonly root: Locator;
  readonly titleHeading: Locator;
  /** The ebook lane's state in words: Looking, Choose a version, Version chosen. */
  readonly state: Locator;
  readonly looking: Locator;
  readonly versions: Locator;
  readonly bestMatchBadges: Locator;
  readonly chosen: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.root = page.getByTestId("request-page");
    this.titleHeading = page.getByTestId("request-title");
    this.state = page.getByTestId("request-state");
    this.looking = page.getByTestId("request-looking");
    this.versions = page.getByTestId("request-version");
    this.bestMatchBadges = page.getByTestId("request-best-match");
    this.chosen = page.getByTestId("request-chosen");
  }

  protected get readyLocator(): Locator {
    return this.root;
  }

  /** The version row in `format`, such as `EPUB`. */
  version(format: string): Locator {
    return this.versions.filter({
      has: this.page.getByText(format, { exact: true }),
    });
  }

  /** The Best match badge on `version`'s row. */
  bestMatchOf(version: Locator): Locator {
    return version.getByTestId("request-best-match");
  }

  async showDetails(version: Locator): Promise<void> {
    await version.getByTestId("request-details-toggle").click();
  }

  detailsOf(version: Locator): Locator {
    return version.getByTestId("request-details");
  }

  async choose(version: Locator): Promise<void> {
    await version.getByTestId("request-choose").click();
  }
}

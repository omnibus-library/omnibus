import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** A book's request page at `/books/{uuid}/request?id=`. */
export class BookRequestPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+\/request\?id=\d+$/;

  readonly topNav: TopNavComponent;

  readonly root: Locator;
  readonly titleHeading: Locator;
  /** The ebook lane's state in words, such as Looking, On its way or Ready to read. */
  readonly state: Locator;
  readonly looking: Locator;
  readonly versions: Locator;
  readonly bestMatchBadges: Locator;
  readonly chosen: Locator;
  /** The download's percent, once the client has reported. */
  readonly percent: Locator;
  readonly lane: Locator;
  readonly tryAgain: Locator;
  /** What went wrong, in technical words; only an admin sees it. */
  readonly stuckDetail: Locator;
  readonly cancel: Locator;

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
    this.percent = page.getByTestId("request-percent");
    this.lane = page.getByTestId("request-lane-ebook");
    this.tryAgain = this.lane.getByRole("button", { name: "Try again" });
    this.stuckDetail = page.getByTestId("request-stuck-detail");
    this.cancel = this.lane.getByRole("button", { name: "Cancel" });
  }

  protected get readyLocator(): Locator {
    return this.root;
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

  /** Opens Details for the lane, which shows every version's long form. */
  async showDetails(): Promise<void> {
    await this.lane.getByRole("button", { name: "Details" }).click();
  }

  detailsOf(version: Locator): Locator {
    return version.getByTestId("request-details");
  }

  async choose(version: Locator): Promise<void> {
    await version.getByTestId("request-choose").click();
  }
}

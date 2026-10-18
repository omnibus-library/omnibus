import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** What the router shows for any path it has no route for. */
export class NotFoundPage extends BasePage {
  protected readonly urlPattern = /.*/;

  readonly topNav: TopNavComponent;

  readonly root: Locator;
  readonly heading: Locator;
  readonly backToLibraryLink: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.root = page.getByTestId("not-found-page");
    this.heading = this.root.getByRole("heading", { name: "Page not found" });
    this.backToLibraryLink = this.root.getByRole("link", {
      name: "Back to library",
    });
  }

  protected get readyLocator(): Locator {
    return this.root;
  }

  /** Opens `path`, which the caller picks to have no route. */
  async goto(path: string): Promise<void> {
    await this.openAndSettle(path);
  }

  async backToLibrary(): Promise<void> {
    await this.backToLibraryLink.click();
  }

  /** Everything the page prints, route table included if it leaked. */
  async bodyText(): Promise<string> {
    return this.page.locator("body").innerText();
  }
}

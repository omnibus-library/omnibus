import type { Locator, Page } from "@playwright/test";
import { CheckInFlowComponent } from "../components/CheckInFlowComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { scanUrls } from "../contracts/scan";
import { isResponseTo } from "../utils/api";
import { BasePage } from "./BasePage";

/** The check-in flow as a full page, the deep-link fallback to the overlay. */
export class CheckInPage extends BasePage {
  protected readonly urlPattern = /\/check-in$/;

  readonly topNav: TopNavComponent;
  readonly flow: CheckInFlowComponent;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.flow = new CheckInFlowComponent(page, page.getByTestId("check-in"));
  }

  protected get readyLocator(): Locator {
    return this.flow.root;
  }

  async goto(): Promise<void> {
    await this.open("/check-in");
  }

  /** Opens the flow and waits for the Google Books key status it reads on mount. */
  async gotoAwaitingKeyStatus(): Promise<void> {
    const status = this.page.waitForResponse(
      isResponseTo({ method: "GET", url: scanUrls.googleBooksConfigured }),
    );
    await this.goto();
    await status;
  }
}

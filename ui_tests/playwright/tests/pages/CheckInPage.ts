import type { Locator, Page } from "@playwright/test";
import { CheckInFlowComponent } from "../components/CheckInFlowComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** The check-in flow full-page: the deep link the overlay falls back to. */
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
}

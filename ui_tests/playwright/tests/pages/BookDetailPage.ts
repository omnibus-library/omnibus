import type { Locator, Page } from "@playwright/test";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

export class BookDetailPage extends BasePage {
  protected readonly urlPattern = /\/books\/[^/?#]+$/;

  readonly topNav: TopNavComponent;
  readonly checkInOverlay: CheckInOverlayComponent;

  readonly titleHeading: Locator;
  readonly fromSameHandEmptyMessage: Locator;
  readonly checkInWhenAcquiredButton: Locator;
  readonly physicalCopyCards: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.checkInOverlay = new CheckInOverlayComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.fromSameHandEmptyMessage = page.getByTestId("from-same-hand-empty");
    this.checkInWhenAcquiredButton = page.getByRole("button", {
      name: "Check in when acquired",
    });
    this.physicalCopyCards = page.getByTestId("physical-copy-card");
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  async goto(bookUuid: string): Promise<void> {
    await this.open(`/books/${bookUuid}`);
  }

  async checkInWhenAcquired(): Promise<void> {
    await this.checkInWhenAcquiredButton.click();
  }
}

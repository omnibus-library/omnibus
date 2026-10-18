import type { Locator, Page } from "@playwright/test";
import type { CleanupKind } from "../data/cleanup";
import { BaseComponent } from "./BaseComponent";

/** Settings → Library cleanup: pending suggestions by kind, and detection. */
export class CleanupSectionComponent extends BaseComponent {
  readonly card: Locator;
  readonly heading: Locator;
  readonly kinds: Locator;
  readonly detectButton: Locator;
  readonly detectStatus: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("cleanup-card");
    this.heading = this.card.getByRole("heading", { name: "Library cleanup" });
    this.kinds = page.getByTestId("cleanup-kinds");
    this.detectButton = page.getByRole("button", { name: "Run detection now" });
    this.detectStatus = page.getByTestId("cleanup-detect-status");
  }

  /** The row summarising one kind's suggestions. */
  kind(kind: CleanupKind): Locator {
    return this.page.getByTestId(`cleanup-kind-${kind}`);
  }

  /** How many suggestions of `kind` are pending. */
  pendingCount(kind: CleanupKind): Locator {
    return this.page.getByTestId(`cleanup-count-${kind}`);
  }

  async runDetection(): Promise<void> {
    await this.detectButton.click();
  }

  /** Follows a kind's Review link, the only way in to its review page. */
  async openReview(kind: CleanupKind): Promise<void> {
    await this.page.getByTestId(`cleanup-review-${kind}`).click();
  }
}

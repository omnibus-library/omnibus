import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The landing page's continue-reading fan, newest position in front. */
export class ContinueStackComponent extends BaseComponent {
  readonly root: Locator;
  readonly fan: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("continue-stack");
    this.fan = this.root.locator(".lmq-fan");
  }

  /** A book's card, whichever position it holds in the fan. */
  card(bookUuid: string): Locator {
    return this.page.getByTestId(`hero-resume-${bookUuid}`);
  }

  /** The cross-format chip, which the front book alone shows. */
  crossFormatChip(bookUuid: string): Locator {
    return this.page.getByTestId(`hero-crossformat-${bookUuid}`);
  }

  /** The Immersive pill, which the front book alone shows. */
  immersiveChip(bookUuid: string): Locator {
    return this.page.getByTestId(`hero-immersive-${bookUuid}`);
  }

  /** Brings a card forward; clicking the front one would navigate instead. */
  async bringForward(bookUuid: string): Promise<void> {
    const card = this.card(bookUuid);
    if ((await card.getAttribute("class"))?.includes("lead")) return;
    // Cards overlap at rest, so spread the fan and click the left sliver.
    await this.fan.hover();
    await card.click({ position: { x: 12, y: 60 } });
  }
}

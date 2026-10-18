import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";

/** The landing page's continue-reading fan, newest position in front. */
export class ContinueStackComponent extends BaseComponent {
  readonly root: Locator;
  readonly fan: Locator;
  /** The landing column, which gains `lmq--past` once the stack scrolls away. */
  readonly landingRoot: Locator;
  readonly edgeRibbon: Locator;

  private readonly cards: Locator;
  private readonly frontCard: Locator;
  private readonly cardsBehind: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("continue-stack");
    this.fan = this.root.locator(".lmq-fan");
    this.landingRoot = page.locator("#lmq-root");
    this.edgeRibbon = page.getByTestId("resume-edge");
    this.cards = this.root.locator(".lmq-fcard");
    this.frontCard = this.root.locator(".lmq-fcard.lead");
    this.cardsBehind = this.root.locator(".lmq-fcard:not(.lead)");
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

  /** The resume card's veil, the verb that travels with the front card. */
  veil(bookUuid: string): Locator {
    return this.card(bookUuid).locator(".lmq-veil-lab");
  }

  /** The edge ribbon's control, which only the widened ribbon exposes. */
  edgeRibbonGo(bookUuid: string): Locator {
    return this.page.getByTestId(`resume-edge-go-${bookUuid}`);
  }

  cardCount(): Promise<number> {
    return this.cards.count();
  }

  /** The book out front; which one leads follows the rail's ordering. */
  async frontUuid(): Promise<string> {
    const testId = await this.frontCard.getAttribute("data-testid");
    return uuidOf(testId, "the fan must have a front card");
  }

  /** The first book behind the front one. */
  async behindUuid(): Promise<string> {
    const testId = await this.cardsBehind.first().getAttribute("data-testid");
    return uuidOf(testId, "the fan must have a card behind the front one");
  }

  /** Brings a card forward; clicking the front one would navigate instead. */
  async bringForward(bookUuid: string): Promise<void> {
    const card = this.card(bookUuid);
    if ((await card.getAttribute("class"))?.includes("lead")) return;
    // Cards overlap at rest, so spread the fan and click the left sliver.
    await this.fan.hover();
    await card.click({ position: { x: 12, y: 60 } });
  }

  /** Presses a key on a focused card, as a keyboard reader would. */
  async pressOn(bookUuid: string, key: "ArrowRight" | "Enter"): Promise<void> {
    await this.card(bookUuid).focus();
    await this.page.keyboard.press(key);
  }

  /** Scrolls until the stack is out of view. */
  async scrollAway(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, 600));
  }

  async scrollBackToTop(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  /** Widens the edge ribbon, which is what exposes its control. */
  async hoverEdgeRibbon(): Promise<void> {
    await this.edgeRibbon.hover();
  }

  /** Checks `leadUuid` is out front and `otherUuid` is not. */
  async assertLeads(leadUuid: string, otherUuid: string): Promise<void> {
    await expect(this.card(leadUuid)).toHaveClass(/\blead\b/);
    await expect(this.card(otherUuid)).not.toHaveClass(/\blead\b/);
  }
}

const RESUME_CARD_PREFIX = "hero-resume-";

function uuidOf(testId: string | null, missing: string): string {
  if (!testId?.startsWith(RESUME_CARD_PREFIX)) throw new Error(missing);
  return testId.slice(RESUME_CARD_PREFIX.length);
}

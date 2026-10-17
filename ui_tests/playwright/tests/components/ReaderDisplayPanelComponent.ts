import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

export const TYPEFACES = [
  "original",
  "editorial",
  "classic",
  "modern",
  "sans",
  "mono",
] as const;

export type Typeface = (typeof TYPEFACES)[number];
export type PageView = "single" | "double";

/** The Aa panel: font size, page view and typeface. */
export class ReaderDisplayPanelComponent extends BaseComponent {
  readonly root: Locator;
  readonly scrim: Locator;
  readonly decreaseFontButton: Locator;
  readonly increaseFontButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("reader-aa-panel");
    // The scrim has no testid and no role.
    this.scrim = page.locator(".rd-scrim");
    this.decreaseFontButton = this.root.getByTestId("reader-font-decrease");
    this.increaseFontButton = this.root.getByTestId("reader-font-increase");
  }

  pageViewButton(view: PageView): Locator {
    return this.root.getByTestId(`reader-spread-${view}`);
  }

  typefaceButton(face: Typeface): Locator {
    return this.root.getByTestId(`reader-typeface-${face}`);
  }

  async choosePageView(view: PageView): Promise<void> {
    await this.pageViewButton(view).click();
  }

  async closeByClickingOutside(): Promise<void> {
    await this.scrim.click();
  }
}

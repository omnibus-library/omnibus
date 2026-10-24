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
export type Theme = "Dark" | "Black" | "Light" | "Sepia";

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

  /** One option of the Theme group, which marks its selected option with `aria-pressed`. */
  themeButton(theme: Theme): Locator {
    return this.root
      .getByRole("group", { name: "Theme" })
      .getByRole("button", { name: theme, exact: true });
  }

  pageViewButton(view: PageView): Locator {
    return this.root.getByTestId(`reader-spread-${view}`);
  }

  typefaceButton(face: Typeface): Locator {
    return this.root.getByTestId(`reader-typeface-${face}`);
  }

  async increaseFontSize(): Promise<void> {
    await this.increaseFontButton.click();
  }

  async choosePageView(view: PageView): Promise<void> {
    await this.pageViewButton(view).click();
  }

  async chooseTheme(theme: Theme): Promise<void> {
    await this.themeButton(theme).click();
  }

  async chooseTypeface(face: Typeface): Promise<void> {
    await this.typefaceButton(face).click();
  }

  async closeByClickingOutside(): Promise<void> {
    await this.scrim.click();
  }
}

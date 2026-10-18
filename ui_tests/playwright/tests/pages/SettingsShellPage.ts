import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** What names one of the two shells that draw the settings frame. */
type ShellIdentity = {
  path: string;
  layoutTestId: string;
  title: string;
  navTestId: string;
};

/**
 * The frame `/settings` and `/admin` share: a sidebar of section links beside
 * the open section, a back link under 720px, and the prompt that holds a
 * section switch back over unsaved edits.
 */
export abstract class SettingsShellPage<
  Section extends string,
> extends BasePage {
  readonly topNav: TopNavComponent;
  readonly layout: Locator;
  readonly heading: Locator;
  readonly backLink: Locator;
  readonly unsavedPrompt: Locator;
  readonly keepEditingButton: Locator;
  readonly discardButton: Locator;

  constructor(
    page: Page,
    private readonly shell: ShellIdentity,
  ) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.layout = page.getByTestId(shell.layoutTestId);
    this.heading = page.getByRole("heading", { level: 1, name: shell.title });
    this.backLink = page.getByTestId("settings-back");
    this.unsavedPrompt = page.getByTestId("unsaved-confirm");
    this.keepEditingButton = page.getByTestId("unsaved-keep");
    this.discardButton = page.getByTestId("unsaved-discard");
  }

  protected get readyLocator(): Locator {
    return this.layout;
  }

  /** The sidebar link to `section`. */
  sectionLink(section: Section): Locator {
    return this.page.getByTestId(`${this.shell.navTestId}-${section}`);
  }

  async goto(section?: Section): Promise<void> {
    await this.openAndSettle(
      section === undefined
        ? this.shell.path
        : `${this.shell.path}?section=${section}`,
    );
  }

  async openSection(section: Section): Promise<void> {
    await this.sectionLink(section).click();
  }

  /** Follows the narrow screen's "‹ title" link from a section to the list. */
  async openSectionList(): Promise<void> {
    await this.backLink.click();
  }

  async keepEditing(): Promise<void> {
    await this.keepEditingButton.click();
  }

  async discardEdits(): Promise<void> {
    await this.discardButton.click();
  }

  /** Whether the page scrolls sideways, which a narrow screen must never do. */
  scrollsSideways(): Promise<boolean> {
    return this.page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
  }

  /** Checks the address names `section`, or the default one with no bare `?`. */
  async assertDisplayedFor(section?: Section): Promise<void> {
    const path = this.shell.path;
    await expect(this.page).toHaveURL(
      section === undefined
        ? new RegExp(`${path}$`)
        : new RegExp(`${path}\\?section=${section}$`),
    );
    await expect(this.layout).toBeVisible();
  }
}

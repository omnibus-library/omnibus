import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The audio player docked along the bottom of the page while a book plays. */
export class MiniDockComponent extends BaseComponent {
  readonly root: Locator;
  readonly titleLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("region", { name: "Now playing" });
    this.titleLabel = this.root.getByTestId("mini-dock-title");
  }

  readonly toggleButton = this.page.getByTestId("mini-dock-toggle");
  readonly expandButton = this.page.getByTestId("mini-dock-expand-btn");
  readonly dismissButton = this.page.getByTestId("mini-dock-dismiss");
  readonly previousChapterButton = this.page.getByTestId("mini-dock-ch-prev");
  readonly nextChapterButton = this.page.getByTestId("mini-dock-ch-next");
  readonly skipBackButton = this.page.getByTestId("mini-dock-skip-back");
  readonly skipForwardButton = this.page.getByTestId("mini-dock-skip-forward");
  readonly volumeButton = this.page.getByTestId("mini-dock-volume");
  readonly speedChip = this.page.getByTestId("mini-dock-speed");
  readonly sleepChip = this.page.getByTestId("mini-dock-sleep");
  readonly volumePopover = this.page.getByTestId("mini-dock-pop-vol");
  readonly speedPopover = this.page.getByTestId("mini-dock-pop-speed");
  readonly sleepPopover = this.page.getByTestId("mini-dock-pop-sleep");
  readonly volumeSlider = this.volumePopover.getByRole("slider", {
    name: "Volume",
  });
  private readonly scrim = this.page.getByTestId("mini-dock-scrim");

  /** What the dock sheds below 900px, leaving play, expand and dismiss. */
  readonly secondaryControls = [
    this.previousChapterButton,
    this.nextChapterButton,
    this.skipBackButton,
    this.skipForwardButton,
    this.volumeButton,
    this.speedChip,
    this.sleepChip,
  ];

  /** A speed preset in the speed popover. */
  speedOption(rate: number): Locator {
    return this.speedPopover.getByRole("button", {
      name: `${rate.toFixed(1)}×`,
      exact: true,
    });
  }

  /** A preset in the sleep popover. */
  sleepPreset(label: string): Locator {
    return this.sleepPopover.getByRole("button", { name: label });
  }

  async toggle(): Promise<void> {
    await this.toggleButton.click();
  }

  async expand(): Promise<void> {
    await this.expandButton.click();
  }

  async dismiss(): Promise<void> {
    await this.dismissButton.click();
  }

  async jumpToNextChapter(): Promise<void> {
    await this.nextChapterButton.click();
  }

  async jumpToPreviousChapter(): Promise<void> {
    await this.previousChapterButton.click();
  }

  async openVolumePopover(): Promise<void> {
    await this.volumeButton.click();
  }

  async openSpeedPopover(): Promise<void> {
    await this.speedChip.click();
  }

  async openSleepPopover(): Promise<void> {
    await this.sleepChip.click();
  }

  async pickSpeed(rate: number): Promise<void> {
    await this.speedOption(rate).click();
  }

  async armSleep(label: string): Promise<void> {
    await this.sleepPreset(label).click();
  }

  /** Clicks the scrim's corner, because its centre can sit under an open panel. */
  async closePopoverFromScrim(): Promise<void> {
    await this.scrim.click({ position: { x: 10, y: 10 } });
  }

  async setVolume(volume: number): Promise<void> {
    await this.volumeSlider.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, volume);
  }

  /** Narrows the window below the breakpoint where the dock sheds its secondary controls. */
  async narrowViewport(): Promise<void> {
    await this.page.setViewportSize({ width: 700, height: 800 });
  }

  /** The speed the chip shows. */
  async shownSpeed(): Promise<number> {
    return Number.parseFloat((await this.speedChip.textContent()) ?? "");
  }

  /** The dock's box and the viewport it is fixed to, in CSS pixels. */
  async bounds(): Promise<DockBounds> {
    const viewport = this.page.viewportSize();
    if (!viewport) throw new Error("the page has no fixed viewport");
    const box = await this.root.evaluate((el) => {
      const { x, width, top, bottom } = el.getBoundingClientRect();
      return { x, width, top, bottom };
    });
    return { ...box, viewport };
  }
}

/** The dock's box against the viewport it is fixed to. */
export type DockBounds = {
  x: number;
  width: number;
  top: number;
  bottom: number;
  viewport: { width: number; height: number };
};

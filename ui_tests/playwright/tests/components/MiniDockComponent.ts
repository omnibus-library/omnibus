import type { Locator, Page } from "@playwright/test";
import { setRange } from "../utils/dom";
import { BaseComponent } from "./BaseComponent";

/** The audio player docked along the bottom of the page while a book plays. */
export class MiniDockComponent extends BaseComponent {
  readonly root: Locator;
  readonly titleLabel: Locator;
  readonly toggleButton: Locator;
  readonly expandButton: Locator;
  readonly dismissButton: Locator;
  readonly previousChapterButton: Locator;
  readonly nextChapterButton: Locator;
  readonly skipBackButton: Locator;
  readonly skipForwardButton: Locator;
  readonly volumeButton: Locator;
  readonly speedChip: Locator;
  readonly sleepChip: Locator;
  readonly volumePopover: Locator;
  readonly speedPopover: Locator;
  readonly sleepPopover: Locator;
  readonly volumeSlider: Locator;
  /** What the dock sheds below 900px, leaving play, expand and dismiss. */
  readonly secondaryControls: Locator[];

  private readonly scrim: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("region", { name: "Now playing" });
    this.titleLabel = this.root.getByTestId("mini-dock-title");
    this.toggleButton = page.getByTestId("mini-dock-toggle");
    this.expandButton = page.getByTestId("mini-dock-expand-btn");
    this.dismissButton = page.getByTestId("mini-dock-dismiss");
    this.previousChapterButton = page.getByTestId("mini-dock-ch-prev");
    this.nextChapterButton = page.getByTestId("mini-dock-ch-next");
    this.skipBackButton = page.getByTestId("mini-dock-skip-back");
    this.skipForwardButton = page.getByTestId("mini-dock-skip-forward");
    this.volumeButton = page.getByTestId("mini-dock-volume");
    this.speedChip = page.getByTestId("mini-dock-speed");
    this.sleepChip = page.getByTestId("mini-dock-sleep");
    this.volumePopover = page.getByTestId("mini-dock-pop-vol");
    this.speedPopover = page.getByTestId("mini-dock-pop-speed");
    this.sleepPopover = page.getByTestId("mini-dock-pop-sleep");
    this.volumeSlider = this.volumePopover.getByRole("slider", {
      name: "Volume",
    });
    this.scrim = page.getByTestId("mini-dock-scrim");
    this.secondaryControls = [
      this.previousChapterButton,
      this.nextChapterButton,
      this.skipBackButton,
      this.skipForwardButton,
      this.volumeButton,
      this.speedChip,
      this.sleepChip,
    ];
  }

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
    await setRange(this.volumeSlider, volume);
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

import type { Locator, Page } from "@playwright/test";
import { ListenDrawersComponent } from "../components/ListenDrawersComponent";
import { SyncOfferComponent } from "../components/SyncOfferComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { crossFormatUrls } from "../contracts/crossFormat";
import { playbackUrls } from "../contracts/playback";
import { expect } from "../fixtures/test";
import { holdRequests } from "../utils/api";
import { nextFrame, setRange } from "../utils/dom";
import { BasePage } from "./BasePage";

/** What the shared `<audio>` element reports, with `position` in book time across parts. */
export type AudioState = {
  paused: boolean;
  position: number;
  volume: number;
  rate: number;
};

/** The three figures of the transport's scrub-time row, in seconds. */
export type ScrubStamps = { elapsed: number; remaining: number; total: number };

/** Seconds behind an `H:MM:SS` or `M:SS` label. */
function hmsToSeconds(label: string): number {
  return label.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** The audiobook player at `/listen/:uuid`, and the shared audio element behind it. */
export class ListenPage extends BasePage {
  protected readonly urlPattern = /\/listen\/[^/?#]+(?:\?.*)?$/;

  readonly topNav: TopNavComponent;
  readonly drawers: ListenDrawersComponent;

  readonly audioElement: Locator;
  readonly preparingOverlay: Locator;
  readonly failedOverlay: Locator;
  readonly notFoundMessage: Locator;
  readonly backToLibraryLink: Locator;
  readonly nowPlayingKicker: Locator;
  readonly chapterMap: Locator;
  readonly seekSlider: Locator;
  readonly skipBackButton: Locator;
  readonly skipForwardButton: Locator;
  readonly playButton: Locator;
  readonly volumeSlider: Locator;
  readonly bufferingBadge: Locator;

  // The speed button and the rate label are one element: its name is the
  // aria-label and its text is the rate.
  readonly speedButton: Locator;
  readonly speedPanel: Locator;
  readonly speedErrorAlert: Locator;

  readonly sleepButton: Locator;
  readonly sleepPanel: Locator;
  readonly sleepStatus: Locator;
  readonly sleepScrim: Locator;

  readonly syncHereButton: Locator;
  readonly syncOffer: SyncOfferComponent;

  private readonly scrubTimes: Locator;
  private readonly openPanel: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.drawers = new ListenDrawersComponent(page);
    this.syncOffer = new SyncOfferComponent(page);
    this.audioElement = page.getByTestId("listen-audio");
    this.preparingOverlay = page.getByTestId("listen-preparing");
    this.failedOverlay = page.getByTestId("listen-failed");
    this.notFoundMessage = page.getByText("Audiobook not found.");
    this.backToLibraryLink = page.getByRole("link", {
      name: "Back to library",
    });
    this.nowPlayingKicker = page.getByText("Now playing");
    this.chapterMap = page.getByTestId("chapter-map");
    this.seekSlider = page.getByRole("slider", { name: "Seek" });
    this.skipBackButton = page.getByRole("button", { name: "Back 30 seconds" });
    this.skipForwardButton = page.getByRole("button", {
      name: "Forward 30 seconds",
    });
    this.playButton = page.getByRole("button", { name: "Play", exact: true });
    this.volumeSlider = page.getByRole("slider", { name: "Volume" });
    this.bufferingBadge = page.getByTestId("listen-buffering");
    this.speedButton = page.getByRole("button", { name: "Playback speed" });
    this.speedPanel = page.getByTestId("speed-panel");
    this.speedErrorAlert = page.getByRole("alert");
    this.sleepButton = page.getByRole("button", { name: /^sleep/i });
    this.sleepPanel = page.getByTestId("sleep-panel");
    this.sleepStatus = page.getByTestId("sleep-status");
    this.sleepScrim = page.locator(".lp-scrim");
    this.syncHereButton = page.getByTestId("listen-sync-here");
    this.scrubTimes = page.getByTestId("listen-scrub-times");
    // The panel's dialog is its scrim, which takes focus when it opens.
    this.openPanel = page.locator('[role="dialog"]:focus-within');
  }

  /** The player once a book resolves, or the notice that none does. */
  protected get readyLocator(): Locator {
    return this.chapterMap.or(this.notFoundMessage);
  }

  titleHeading(title: string): Locator {
    return this.page.getByRole("heading", { name: title });
  }

  byline(author: string): Locator {
    return this.page.getByText(`by ${author}`);
  }

  detailsLink(title: string): Locator {
    return this.page.getByRole("link", { name: `Open details for ${title}` });
  }

  speedOption(rate: number): Locator {
    return this.page.getByRole("button", {
      name: `${rate.toFixed(1)}×`,
      exact: true,
    });
  }

  /** A preset in the sleep panel, scoped to it because the toolbar button also reads "Sleep · off". */
  sleepPreset(label: string): Locator {
    return this.sleepPanel.getByRole("button", { name: label });
  }

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/listen/${bookUuid}`);
  }

  /** Opens the player without waiting for network idle, which a held request never reaches. */
  async gotoUnsettled(bookUuid: string): Promise<void> {
    await this.open(`/listen/${bookUuid}`);
  }

  /** Waits until the player has handed its book's audio to the element, when its controls can be driven. */
  async waitUntilPlayerReady(): Promise<void> {
    await this.preparingOverlay.waitFor({ state: "detached" });
    await this.page.waitForFunction(
      () => document.querySelector("audio")?.hasAttribute("src") === true,
      undefined,
      { timeout: 10_000 },
    );
  }

  /**
   * Opens the book and leaves for the library, so the dock takes over. Pass
   * `settle: false` while a request is held, since the page never idles then.
   */
  async openThenBrowseAway(
    bookUuid: string,
    { settle = true } = {},
  ): Promise<void> {
    await (settle ? this.goto(bookUuid) : this.gotoUnsettled(bookUuid));
    await this.waitUntilPlayerReady();
    await this.browseToLibrary();
  }

  /**
   * Takes the top nav's Library link. That hop is client-side, so playback and
   * the dock survive it where a `goto` would remount the app and drop them.
   */
  async browseToLibrary(): Promise<void> {
    await this.topNav.openLibrary();
    await this.page.waitForURL(/\/$/);
  }

  /**
   * Opens another audiobook by a client-side route change, which keeps the
   * player mounted. The router follows `popstate`, so pushing the entry and
   * announcing it is the hop an in-app link makes.
   */
  async switchToAudiobook(bookUuid: string): Promise<void> {
    await this.page.evaluate((path) => {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/listen/${bookUuid}`);
  }

  async openBookDetail(title: string): Promise<void> {
    await this.detailsLink(title).click();
  }

  async play(): Promise<void> {
    await this.playButton.click();
  }

  async openSpeedPanel(): Promise<void> {
    await this.speedButton.click();
  }

  async pickSpeed(rate: number): Promise<void> {
    await this.speedOption(rate).click();
  }

  async openSleepPanel(): Promise<void> {
    await this.sleepButton.click();
  }

  async armSleep(label: string): Promise<void> {
    await this.sleepPreset(label).click();
  }

  /** Clicks the scrim the open sleep panel puts over the transport. */
  async dismissSleepScrim(): Promise<void> {
    await this.sleepScrim.click();
  }

  /** Presses Escape once the open panel holds focus, which is what routes the key to it. */
  async closePanelWithEscape(): Promise<void> {
    await this.openPanel.waitFor();
    await this.page.keyboard.press("Escape");
  }

  async setVolume(volume: number): Promise<void> {
    await setRange(this.volumeSlider, volume);
  }

  /** Drags the scrubber, which previews the position without seeking, and lets two frames pass. */
  async previewSeek(seconds: number): Promise<void> {
    await setRange(this.seekSlider, seconds);
    // Without the frames, a (wrong) async seek could land after the caller's read.
    await nextFrame(this.page, 2);
  }

  /** Releases the scrubber at `seconds`, which is what seeks and saves the position. */
  async releaseSeek(seconds: number): Promise<void> {
    await setRange(this.seekSlider, seconds, { commit: true });
  }

  /** Seeks the way a user does, by releasing the scrubber; it moves in whole seconds. */
  async seekTo(seconds: number): Promise<void> {
    await this.releaseSeek(seconds);
  }

  /**
   * Parks the playhead at the start, so a position another test left behind
   * cannot change which chapter is current or what the transport paints (#2458).
   */
  async parkAtStart(): Promise<void> {
    await this.seekTo(0);
    await this.page.waitForFunction(() => {
      const audio = document.querySelector("audio");
      return audio !== null && audio.currentTime < 0.5;
    });
  }

  /** Waits out two of the stall watchdog's half-second polls, so a badge it wrongly raised would show. */
  async waitOutWatchdogPolls(): Promise<void> {
    await this.page.waitForTimeout(1_200);
  }

  /** Waits out the window in which a sleep timer that wrongly re-armed would restart playback. */
  async waitOutSleepRearm(): Promise<void> {
    await this.page.waitForTimeout(2_500);
  }

  async declareSyncPoint(): Promise<void> {
    await this.syncHereButton.click();
  }

  /** The audio element's state, or null while there is none. */
  async audioState(): Promise<AudioState | null> {
    return this.page.evaluate(async () => {
      const audio = document.querySelector("audio");
      if (!audio) return null;
      // A multi-part book swaps `src` at a part boundary and `currentTime`
      // restarts there, so the book position adds the parts before this one,
      // read off the manifest the part's own URL belongs to.
      const src = audio.getAttribute("src") ?? "";
      const part = /^(\/api\/audiobooks\/[^/]+)\/parts\/\d+(\?.*)?$/.exec(src);
      let offset = 0;
      if (part) {
        const manifest: {
          parts?: { url: string; duration_seconds: number }[];
        } = await (await fetch(`${part[1]}/manifest${part[2] ?? ""}`)).json();
        for (const each of manifest.parts ?? []) {
          if (each.url === src) break;
          offset += each.duration_seconds;
        }
      }
      return {
        paused: audio.paused,
        position: offset + audio.currentTime,
        volume: audio.volume,
        rate: audio.playbackRate,
      };
    });
  }

  /** The book position in seconds, or NaN while there is no audio element, which no comparison satisfies. */
  async audioPosition(): Promise<number> {
    return (await this.audioState())?.position ?? Number.NaN;
  }

  /** The scrubber's position in seconds. */
  async seekPosition(): Promise<number> {
    return Number(await this.seekSlider.inputValue());
  }

  /** The scrubber's end in seconds, the book's length. */
  async seekLength(): Promise<number> {
    return Number(await this.seekSlider.getAttribute("max"));
  }

  /**
   * The scrub-time row's figures. Elapsed and total are book time; the middle
   * "remaining" is the one that follows the speed (#2344).
   */
  async scrubStamps(): Promise<ScrubStamps> {
    const text = (await this.scrubTimes.innerText())
      .replace(/\s+/g, " ")
      .trim();
    const [elapsed, remaining, total, ...extra] = (
      text.match(/\d+(?::\d\d)+/g) ?? []
    ).map(hmsToSeconds);
    if (
      elapsed === undefined ||
      remaining === undefined ||
      total === undefined ||
      extra.length > 0
    ) {
      throw new Error(`scrub row should carry three stamps: ${text}`);
    }
    return { elapsed, remaining, total };
  }

  /**
   * Whether `panel` is painted over the centre of `control`. Hit-testing is the
   * honest check: a panel that only looks clear still swallows the click.
   */
  async isCoveredBy(control: Locator, panel: Locator): Promise<boolean> {
    const box = await control.boundingBox();
    if (!box) throw new Error("the control has no box to hit-test");
    return panel.evaluate(
      (el, point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return hit !== null && el.contains(hit);
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
  }

  /**
   * The element reports a play and then a pause at `seconds`, after a user's
   * own action (#1972). No real audio needs to play: the element's clock is
   * moved first, then its `play` and `pause` events fire as playback would.
   */
  async reportPause(seconds: number): Promise<void> {
    await this.page.evaluate(async (at) => {
      const audio = document.querySelector("audio");
      if (!audio) throw new Error("no audio element");
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise((done) =>
          audio.addEventListener("loadedmetadata", done, { once: true }),
        );
      }
      const seeked = new Promise((done) =>
        audio.addEventListener("seeked", done, { once: true }),
      );
      audio.currentTime = at;
      await seeked;
      audio.dispatchEvent(new Event("play"));
      audio.dispatchEvent(new Event("pause"));
    }, seconds);
  }

  /** Seeds the speed this browser remembers for a book, before the page loads. */
  async presetLocalSpeed(
    userId: number,
    bookUuid: string,
    rate: number,
  ): Promise<void> {
    await this.presetLocalStorage(
      `omn.listening.rate::${userId}::${bookUuid}`,
      String(rate),
    );
  }

  /** Holds the media bytes, so `loadedmetadata` cannot fire while a test reads the transport. */
  async holdAudioParts(): Promise<() => void> {
    return holdRequests(this.page, "**/api/audiobooks/**/parts/**");
  }

  /** Holds a book's manifest, so its preparing overlay stays up long enough to observe. */
  async holdManifest(bookUuid: string): Promise<() => void> {
    return holdRequests(
      this.page,
      (url) =>
        url.pathname.includes("/manifest") && url.pathname.includes(bookUuid),
    );
  }

  /** Answers the saved-speed read with none, a state the server can only produce once per book and account. */
  async stubNoSavedSpeed(): Promise<void> {
    await this.page.route(playbackUrls.rate, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "null",
          })
        : route.fallback(),
    );
  }

  /** Lets the saved-speed read reach the server again after `stubNoSavedSpeed`. */
  async restoreSavedSpeedReads(): Promise<void> {
    await this.page.unroute(playbackUrls.rate);
  }

  /** Answers the speed write with success without storing it, for tests that only read the display. */
  async stubPlaybackRateSaved(): Promise<void> {
    await this.page.route(playbackUrls.rate, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{}",
          })
        : route.fallback(),
    );
  }

  /** Refuses a sync-point declaration the way the server does for an unlinked book: a 500 carrying code 428. */
  async stubSyncPointRefusal(): Promise<void> {
    await this.page.route(crossFormatUrls.syncPoint, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Choose the matching formats before syncing.",
          code: 428,
        }),
      }),
    );
  }

  /** Checks the player is on `bookUuid`, at the part `fileId` when given. */
  async assertDisplayedFor(bookUuid: string, fileId?: number): Promise<void> {
    // #2256: without a file the url has no trailing `?`.
    const query = fileId === undefined ? "" : `\\?file_id=${fileId}`;
    await expect(this.page).toHaveURL(
      new RegExp(`/listen/${bookUuid}${query}$`),
    );
    await expect(this.chapterMap).toBeVisible();
  }
}

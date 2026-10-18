import { playback } from "../contracts/playback";
import {
  AUDIOBOOK_BOOK_COUNT,
  AUDIOBOOK_BOOKS,
  MERGE_ONLY_TITLES,
} from "../fixtures/audiobooks";
import { AUTO_ATTACHED_PAIRS } from "../fixtures/dual_format";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

// Read-only spec: exclude the merge-only fixtures so a merge in flight can
// never change what these assertions see.
const MP3_BOOK = AUDIOBOOK_BOOKS.find(
  (b) =>
    b.format === "MP3" &&
    b.source === "generated" &&
    !MERGE_ONLY_TITLES.includes(b.title),
)!;
// Multi-part book → one synthetic chapter per part, so the chapter-jump
// buttons have a real boundary to cross (same reasoning as listen.spec.ts).
const MULTIPART_MP3_BOOK = AUDIOBOOK_BOOKS.find(
  (b) => b.format === "MP3" && b.parts > 1,
)!;
// Distinct author from every audiobook fixture so auto-attach never merges
// this EPUB with the playing audiobook mid-test.
const READER_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "gamma")!;

test.describe("mini-dock", () => {
  // Both libraries, so the reader test has an EPUB to read beside the playing
  // audiobook; the combined total subtracts the auto-attached pairs. Seeded as
  // two writes, because one reindexing both was seen to lose the EPUB in CI.
  test.beforeAll("seed both libraries", async ({ request }) => {
    // Two sequential seed polls (ebooks then audiobooks), up to 45s each, so
    // this hook needs more than the 60s config default.
    test.setTimeout(120_000);
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    await seedAudiobookLibrary(
      request,
      audiobookFixturesDir(),
      FIXTURE_BOOKS.length + AUDIOBOOK_BOOK_COUNT - AUTO_ATTACHED_PAIRS,
    );
  });

  test("show the mini-dock layout", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    await test.step("check the shared nav shows", async () => {
      await libraryPage.topNav.assertDisplayed();
    });

    // One content-sized flex row spanning the full viewport width.
    await test.step("check the dock is a single full-width row", async () => {
      await expect(miniDock.root).toBeVisible();
      await expect(miniDock.root).toHaveCSS("display", "flex");
      await expect(miniDock.root).not.toHaveCSS("flex-wrap", "wrap");
      // Edge to edge within a sub-pixel tolerance: the box is float and can
      // land at N ± 0.5 depending on the renderer's rounding.
      const bounds = await miniDock.bounds();
      expect(bounds.width).toBeCloseTo(bounds.viewport.width, 0);
      expect(bounds.x).toBeCloseTo(0, 0);
    });
  });

  test("keep the mini-dock on other pages while an audiobook is loaded", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook", async () => {
      await listenPage.goto(uuid);
      await listenPage.waitUntilPlayerReady();
    });

    // The full player route renders without ScreenLayout, so no dock there.
    await test.step("check the full player shows no dock", async () => {
      await expect(miniDock.root).toHaveCount(0);
    });

    await test.step("browse to the library", async () => {
      await listenPage.browseToLibrary();
    });

    await test.step("check the dock shows the playing book", async () => {
      await expect(miniDock.root).toBeVisible();
      await expect(miniDock.titleLabel).toHaveText(MP3_BOOK.title);
    });
  });

  test("reflect playback state on the dock's play button", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    await test.step("check the dock offers play", async () => {
      await expect(miniDock.toggleButton).toBeVisible();
      await expect(miniDock.toggleButton).toHaveAttribute("aria-label", "Play");
    });

    // The dock reads the shared `playing` signal, so its label flips without
    // any route change.
    await test.step("report playback starting", async () => {
      await listenPage.reportPlaying();
      await expect(miniDock.toggleButton).toHaveAttribute(
        "aria-label",
        "Pause",
      );
    });

    // The click drives the same OmnibusAudio surface as the full player: it
    // must exist, and the click must not throw.
    await test.step("press the dock's button", async () => {
      expect(await listenPage.audioShimCanToggle()).toBe(true);
      await miniDock.toggle();
    });
  });

  test("expand the dock back to the full player", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
      await expect(miniDock.root).toBeVisible();
    });

    await test.step("expand the dock", async () => {
      await miniDock.expand();
    });

    await test.step("check the full player shows and the dock is gone", async () => {
      await listenPage.assertDisplayedFor(uuid);
      await expect(listenPage.playButton).toBeVisible();
      await expect(miniDock.root).toHaveCount(0);
    });
  });

  test("adjust the volume from the dock popover", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    // The bar row has no inline slider: volume lives behind an icon.
    await test.step("open the volume popover", async () => {
      await expect(miniDock.volumePopover).not.toHaveClass(/open/);
      await miniDock.toggleVolumePopover();
      await expect(miniDock.volumePopover).toHaveClass(/open/);
    });

    // The popover writes through the shared apply_volume seam, so the change
    // reaches the shared `<audio>` element in real time.
    await test.step("set the volume", async () => {
      await miniDock.setVolume(0.3);
      await expect
        .poll(async () => (await listenPage.audioState())?.volume)
        .toBeCloseTo(0.3, 2);
    });

    await test.step("close the popover from the scrim", async () => {
      await miniDock.closePopoverFromScrim();
      await expect(miniDock.volumePopover).not.toHaveClass(/open/);
    });
  });

  test("set the playback speed from the dock popover", async ({
    listenPage,
    libraryPage,
    request,
    expectMutation,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    // The chip opens the same preset-grid panel as the full player; pick a
    // preset different from the persisted rate.
    await test.step("open the speed popover", async () => {
      await expect(miniDock.speedPopover).not.toHaveClass(/open/);
      await miniDock.toggleSpeedPopover();
      await expect(miniDock.speedPopover).toHaveClass(/open/);
    });

    const start = await miniDock.shownSpeed();
    const next = Math.abs(start - 1.5) > 0.001 ? 1.5 : 1.2;

    await test.step("pick a different speed", async () => {
      await expectMutation(playback.setRate(uuid, next), () =>
        miniDock.pickSpeed(next),
      );
      await expect(miniDock.speedChip).toContainText(`${next.toFixed(1)}×`);
    });

    // The panel writes through the shared apply_rate seam, so the change
    // reaches the shared `<audio>` element's playbackRate in real time.
    await test.step("check the audio plays at the new speed", async () => {
      await expect
        .poll(async () => (await listenPage.audioState())?.rate)
        .toBeCloseTo(next, 2);
    });

    // Both controls share one signal, so the full player shows the same rate.
    await test.step("close the popover and expand to the full player", async () => {
      await miniDock.closePopoverFromScrim();
      await expect(miniDock.speedPopover).not.toHaveClass(/open/);
      await miniDock.expand();
      await listenPage.assertDisplayedFor(uuid);
      await expect(listenPage.speedButton).toContainText(next.toFixed(1));
    });
  });

  test("arm a sleep countdown from the dock popover", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    await test.step("open the sleep popover", async () => {
      await expect(miniDock.sleepChip).toHaveText("Sleep");
      await expect(miniDock.sleepPopover).not.toHaveClass(/open/);
      await miniDock.toggleSleepPopover();
      await expect(miniDock.sleepPopover).toHaveClass(/open/);
    });

    // The countdown begins decrementing immediately, so accept 29:xx or 30:00.
    await test.step("arm 30 minutes", async () => {
      await miniDock.armSleep("30 min");
      await expect(miniDock.sleepChip).toHaveText(/^Sleep · (29:\d\d|30:00)$/);
    });

    // The controller is app-scoped: expanding to the full player shows the
    // same running countdown.
    await test.step("expand to the full player", async () => {
      await miniDock.closePopoverFromScrim();
      await miniDock.expand();
      await listenPage.assertDisplayedFor(uuid);
      await listenPage.openSleepPanel();
      await expect(listenPage.sleepStatus).toHaveText(/^(29|30):\d\d$/);
    });
  });

  test("jump across chapter boundaries from the dock", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MULTIPART_MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    // From position 0 (chapter 1) the target is chapter 2's start, so the book
    // position must move strictly forward past zero.
    await test.step("jump to the next chapter", async () => {
      await miniDock.jumpToNextChapter();
      await expect.poll(() => listenPage.audioPosition()).toBeGreaterThan(0);
    });

    // Freshly landed at a chapter start (≤ 3 s in), the target is the previous
    // chapter's start, back to 0.
    await test.step("jump back to the previous chapter", async () => {
      const afterNext = await listenPage.audioPosition();
      await miniDock.jumpToPreviousChapter();
      await expect
        .poll(() => listenPage.audioPosition())
        .toBeLessThan(afterNext);
    });
  });

  test("close one dock popover when another opens", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    await test.step("open the speed popover", async () => {
      await miniDock.toggleSpeedPopover();
      await expect(miniDock.speedPopover).toHaveClass(/open/);
    });

    await test.step("open the sleep popover", async () => {
      await miniDock.toggleSleepPopover();
      await expect(miniDock.sleepPopover).toHaveClass(/open/);
      await expect(miniDock.speedPopover).not.toHaveClass(/open/);
    });

    await test.step("press the sleep chip again", async () => {
      await miniDock.toggleSleepPopover();
      await expect(miniDock.sleepPopover).not.toHaveClass(/open/);
    });
  });

  test("shed the secondary controls on narrow viewports", async ({
    listenPage,
    libraryPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
    });

    await test.step("narrow the window", async () => {
      await libraryPage.resizeViewport({ width: 700, height: 800 });
    });

    // Chapter jumps, ±30 seeks, volume, speed and sleep disappear below the
    // 900px breakpoint…
    await test.step("check the secondary controls are hidden", async () => {
      for (const control of miniDock.secondaryControls) {
        await expect(control).toBeHidden();
      }
    });

    await test.step("check play, expand and dismiss stay reachable", async () => {
      await expect(miniDock.toggleButton).toBeVisible();
      await expect(miniDock.expandButton).toBeVisible();
      await expect(miniDock.dismissButton).toBeVisible();
    });
  });

  test("dismiss the dock", async ({ listenPage, libraryPage, request }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const { miniDock } = libraryPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(uuid);
      await expect(miniDock.root).toBeVisible();
    });

    await test.step("dismiss the dock", async () => {
      await miniDock.dismiss();
    });

    await test.step("check the dock is gone", async () => {
      await expect(miniDock.root).toHaveCount(0);
    });
  });

  // The reader has no transport of its own, so a book playing in the
  // background needs the dock (#988).
  test("show the mini-dock on the immersive reader while an audiobook is loaded", async ({
    listenPage,
    libraryPage,
    bookDetailPage,
    epubReaderPage,
    request,
  }) => {
    const audiobookUuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const readerUuid = await fetchBookUuidByTitle(request, READER_BOOK.title);
    const { miniDock } = epubReaderPage;

    await test.step("open the audiobook, then browse to the library", async () => {
      await listenPage.openThenBrowseAway(audiobookUuid);
    });

    // Every hop is client-side: a native page load would remount `App` and
    // drop the in-memory playback context the dock reads.
    await test.step("open the book and start reading it", async () => {
      await expect(libraryPage.bookTile(READER_BOOK.title)).toBeVisible();
      await libraryPage.openBook(READER_BOOK.title);
      await bookDetailPage.assertDisplayedFor(readerUuid);
      await bookDetailPage.startReading();
      await epubReaderPage.assertDisplayedFor(readerUuid);
    });

    await test.step("check the dock shows the playing book", async () => {
      await expect(miniDock.root).toBeVisible();
      await expect(miniDock.titleLabel).toHaveText(MP3_BOOK.title);
    });

    // A dock control works identically here as elsewhere (AC3).
    await test.step("drive the dock's play button", async () => {
      await expect(miniDock.toggleButton).toHaveAttribute("aria-label", "Play");
      await listenPage.reportPlaying();
      await expect(miniDock.toggleButton).toHaveAttribute(
        "aria-label",
        "Pause",
      );
      await miniDock.toggle();
    });

    // The dock sits flush at the bottom edge and the reader's bottom bar
    // becomes a slim footer pinned directly above it, so the two stack rather
    // than collide (#988). The footer renders unconditionally in `BookReadPage`.
    await test.step("check the footer stacks directly above the dock", async () => {
      const dock = await miniDock.bounds();
      expect(dock.bottom).toBeCloseTo(dock.viewport.height, 0);
      expect(await epubReaderPage.footerBottom()).toBeCloseTo(dock.top, 0);
    });

    // The reader's own progress ribbon yields to the dock's rail.
    await test.step("check the reader's progress ribbon is hidden", async () => {
      await expect(epubReaderPage.progressRibbon).toBeHidden();
    });
  });
});

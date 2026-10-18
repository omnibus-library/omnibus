import { bookmarks } from "../contracts/bookmarks";
import { playback } from "../contracts/playback";
import { progress } from "../contracts/progress";
import type { SeededBookmark } from "../data/bookmarks";
import { savedAudioPosition } from "../data/progress";
import {
  AUDIOBOOK_BOOK_COUNT,
  AUDIOBOOK_BOOKS,
  MERGE_ONLY_TITLES,
  RESUME_BOOK,
  SCRUB_BOOK,
  SLEEP_SEAM_BOOK,
  SLEEP_SEAM_SECONDS,
} from "../fixtures/audiobooks";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { audiobookFixturesDir, seedAudiobookLibrary } from "../utils/seed";

// This spec only ever *reads* its books, so every selector below excludes the
// merge-only fixtures — a merge in flight would change what they assert.
const MP3_BOOK = AUDIOBOOK_BOOKS.find(
  (b) =>
    b.format === "MP3" &&
    b.source === "generated" &&
    !MERGE_ONLY_TITLES.includes(b.title),
)!;
const M4B_BOOK = AUDIOBOOK_BOOKS.find((b) => b.format === "M4B")!;
const MULTIPART_MP3_BOOK = AUDIOBOOK_BOOKS.find(
  (b) => b.format === "MP3" && b.parts > 1,
)!;
const LOCAL_SEED_BOOK = AUDIOBOOK_BOOKS.find(
  (b) => b.format === "MP3" && b.source === "public_domain",
)!;
// The one-clock test needs chapters of minutes, not a generated book's ~2.09s,
// which `format_hms` renders too coarsely to tell 1x from rate-adjusted. The
// public-domain M4B is the only long book no other spec saves a rate on.
const CHAPTERED_BOOK = M4B_BOOK;

test.describe("listen page", () => {
  test.beforeAll("seed the audiobook library", async ({ request }) => {
    await seedAudiobookLibrary(
      request,
      audiobookFixturesDir(),
      AUDIOBOOK_BOOK_COUNT,
    );
  });

  test("show the listen page layout for an mp3 audiobook", async ({
    listenPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

    // The preparing overlay covers the controls until the JS bootstrap wires
    // the book, so the player is driven only once it clears.
    await test.step("open the player", async () => {
      await listenPage.goto(uuid);
      await listenPage.waitUntilPlayerReady();
    });

    await test.step("check the page and its nav", async () => {
      await listenPage.assertDisplayedFor(uuid);
      await listenPage.topNav.assertDisplayed();
      await expect(listenPage.audioElement).toBeAttached();
      await expect(listenPage.failedOverlay).toHaveCount(0);
      await expect(listenPage.nowPlayingKicker).toBeVisible();
    });

    // The title and byline block links back to the book's detail page.
    await test.step("check the book's title, byline and link show", async () => {
      await expect(listenPage.titleHeading(MP3_BOOK.title)).toBeVisible();
      await expect(listenPage.byline(MP3_BOOK.author)).toBeVisible();
      await expect(listenPage.detailsLink(MP3_BOOK.title)).toBeVisible();
    });

    await test.step("check the transport shows", async () => {
      await expect(listenPage.chapterMap).toBeVisible();
      await expect(listenPage.seekSlider).toBeVisible();
      await expect(listenPage.skipBackButton).toBeVisible();
      await expect(listenPage.skipForwardButton).toBeVisible();
      await expect(listenPage.playButton).toBeVisible();
      await expect(listenPage.speedButton).toBeVisible();
      await expect(listenPage.volumeSlider).toBeVisible();
    });
  });

  test("show the listen page for an m4b audiobook", async ({
    listenPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, M4B_BOOK.title);

    await test.step("open the player", async () => {
      await listenPage.goto(uuid);
    });

    await test.step("check the play button and the book's title show", async () => {
      await expect(listenPage.playButton).toBeVisible();
      await expect(listenPage.titleHeading(M4B_BOOK.title)).toBeVisible();
      await expect(listenPage.byline(M4B_BOOK.author)).toBeVisible();
      await listenPage.waitUntilPlayerReady();
    });
  });

  test("open the book detail page from the book title", async ({
    listenPage,
    bookDetailPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

    await test.step("open the player", async () => {
      await listenPage.goto(uuid);
      await listenPage.waitUntilPlayerReady();
    });

    await test.step("click the book title", async () => {
      await listenPage.openBookDetail(MP3_BOOK.title);
    });

    await test.step("check the book detail page shows", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
    });
  });

  test("open the player from the book detail listen action", async ({
    bookDetailPage,
    listenPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // `routes::link_target` trims the bare trailing `?` dioxus-router writes
    // for an unset `?file_id` (#2256), so the URL is exactly `/listen/:uuid`.
    await test.step("press listen", async () => {
      await bookDetailPage.formats.listen();
      await listenPage.assertDisplayedFor(uuid);
      await expect(listenPage.playButton).toBeVisible();
    });
  });

  test("show a not-found message for an unknown audiobook", async ({
    listenPage,
  }) => {
    await test.step("open the player for a uuid no book has", async () => {
      await listenPage.goto("00000000-0000-0000-0000-000000000000");
    });

    await test.step("check the not-found notice offers the way back", async () => {
      await expect(listenPage.notFoundMessage).toBeVisible();
      await expect(listenPage.backToLibraryLink).toBeVisible();
    });
  });

  test("reset the player when switching audiobooks client-side (#369)", async ({
    listenPage,
    request,
  }) => {
    const uuid1 = await fetchBookUuidByTitle(request, MP3_BOOK.title);
    const uuid2 = await fetchBookUuidByTitle(request, M4B_BOOK.title);

    await test.step("open the first audiobook", async () => {
      await listenPage.goto(uuid1);
      await expect(listenPage.titleHeading(MP3_BOOK.title)).toBeVisible();
      await listenPage.waitUntilPlayerReady();
    });

    // Direct-play books flip hls_ready in <10 ms, so without the hold the
    // overlay is never observable. The hold also proves hls_ready was reset: if
    // it leaked as true from the first book, the overlay would never appear.
    const release =
      await test.step("hold the second audiobook's manifest", () =>
        listenPage.holdManifest(uuid2));

    await test.step("switch to the second audiobook", async () => {
      await listenPage.switchToAudiobook(uuid2);
      await expect(listenPage.titleHeading(M4B_BOOK.title)).toBeVisible({
        timeout: 10_000,
      });
    });

    // Positive proof that hls_ready was reset: a stale true from the first
    // book would fail this.
    await test.step("check the player is preparing the second audiobook", async () => {
      await expect(listenPage.preparingOverlay).toBeVisible();
      await expect(listenPage.failedOverlay).not.toBeVisible();
    });

    await test.step("release the manifest", async () => {
      release();
      await listenPage.waitUntilPlayerReady();
    });

    await test.step("check the player is ready to play", async () => {
      await expect(listenPage.failedOverlay).not.toBeVisible();
      await expect(listenPage.playButton).toBeVisible();
    });
  });

  test.describe("playback speed", () => {
    test("persist the speed per audiobook across reloads", async ({
      listenPage,
      request,
      expectMutation,
    }) => {
      const uuidA = await fetchBookUuidByTitle(request, MP3_BOOK.title);
      const uuidB = await fetchBookUuidByTitle(request, M4B_BOOK.title);

      await test.step("open the first audiobook", async () => {
        await listenPage.goto(uuidA);
        await listenPage.waitUntilPlayerReady();
      });

      await test.step("choose 1.5×", async () => {
        await listenPage.openSpeedPanel();
        await expectMutation(playback.setRate(uuidA, 1.5), () =>
          listenPage.pickSpeed(1.5),
        );
        await expect(listenPage.speedButton).toHaveText("1.50×");
      });

      await test.step("reload", async () => {
        await listenPage.reload();
        await listenPage.waitUntilPlayerReady();
        await expect(listenPage.speedButton).toHaveText("1.50×");
      });

      // The label alone is no proof: the regression showed 1.50× while the
      // audio played at 1.0, because a media load() resets playbackRate. The
      // element only keeps the rate if the shim re-applies it on loadedmetadata.
      await test.step("check the audio element plays at the restored speed", async () => {
        await expect
          .poll(async () => (await listenPage.audioState())?.rate, {
            message:
              "audio element should actually play at the restored 1.5× after reload",
            timeout: 10_000,
            intervals: [50, 100, 250, 500],
          })
          .toBe(1.5);
      });

      await test.step("open the second audiobook", async () => {
        await listenPage.goto(uuidB);
        await listenPage.waitUntilPlayerReady();
        await expect(listenPage.speedButton).toHaveText("1.00×");
      });
    });

    // The server cannot go back to having no saved speed once it has one, so
    // the empty preference is stubbed; the seeding write still reaches it.
    test("seed an empty server preference from the account-scoped local speed", async ({
      listenPage,
      request,
      adminSession,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, LOCAL_SEED_BOOK.title);

      await test.step("remember 1.8× in this browser with no speed saved", async () => {
        await listenPage.stubNoSavedSpeed();
        await listenPage.presetLocalSpeed(adminSession.user.id, uuid, 1.8);
      });

      await test.step("open the player", async () => {
        await expectMutation(playback.setRate(uuid, 1.8), async () => {
          await listenPage.goto(uuid);
          await listenPage.waitUntilPlayerReady();
        });
        await expect(listenPage.speedButton).toHaveText("1.80×");
      });

      await test.step("reload with the server's own saved speed", async () => {
        await listenPage.restoreSavedSpeedReads();
        await listenPage.reload();
        await listenPage.waitUntilPlayerReady();
        await expect(listenPage.speedButton).toHaveText("1.80×");
      });
    });

    test("surface a failed speed save without reverting playback", async ({
      listenPage,
      request,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(
        request,
        MULTIPART_MP3_BOOK.title,
      );

      await test.step("open the player while speed saves fail", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await listenPage.forceServerError(playback.setRate(uuid, 1.8));
      });

      await test.step("choose 1.8×", async () => {
        await listenPage.openSpeedPanel();
        await expectMutation(failing(playback.setRate(uuid, 1.8)), () =>
          listenPage.pickSpeed(1.8),
        );
      });

      await test.step("check the speed stays and the error shows", async () => {
        await expect(listenPage.speedButton).toHaveText("1.80×");
        await expect(listenPage.speedErrorAlert).toContainText(
          "Could not save playback speed",
        );
      });
    });

    // Regression for #2344: elapsed and total are the book's own running time,
    // the basis of the bookmark stamps, so only the "time left" follows speed.
    test("keep the transport total in book time and rescale only the time left", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, CHAPTERED_BOOK.title);

      // The rate write is stubbed: this asserts what the player *displays*, and
      // a real write would set a speed every other test on this fixture sees.
      await test.step("open the player with speed saves stubbed", async () => {
        await listenPage.stubPlaybackRateSaved();
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await expect(listenPage.speedButton).toHaveText("1.00×");
      });

      const at1x = await test.step("read the time stamps at 1×", async () => {
        const stamps = await listenPage.scrubStamps();
        expect(stamps.total).toBeGreaterThan(0);
        expect(stamps.remaining).toBeGreaterThan(0);
        return stamps;
      });

      await test.step("choose 2×", async () => {
        await listenPage.openSpeedPanel();
        await listenPage.pickSpeed(2);
        await expect(listenPage.speedButton).toHaveText("2.00×");
        await listenPage.closePanelWithEscape();
        await expect(listenPage.speedPanel).toHaveCount(0);
      });

      await test.step("check only the time left follows the speed", async () => {
        const at2x = await listenPage.scrubStamps();
        // The total is book time — the same at 2x as at 1x (a second of slack
        // absorbs `format_hms` truncation).
        expect(Math.abs(at2x.total - at1x.total)).toBeLessThanOrEqual(1);
        // The time left is the one rate-adjusted figure — halved at 2x.
        expect(at2x.remaining).toBeLessThan(at1x.remaining);
        expect(
          Math.abs(at2x.remaining - at1x.remaining / 2),
        ).toBeLessThanOrEqual(1);
      });
    });
  });

  test.describe("listening progress", () => {
    test("save the position when the audio pauses", async ({
      listenPage,
      request,
      audioFileId,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
      const bookFileId = await audioFileId(uuid);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
      });

      // No real audio plays in headless Chromium, so the pause callback is
      // driven directly.
      await test.step("pause at 7.5 seconds", async () => {
        await expectMutation(progress.saveAudio(uuid, 7.5, bookFileId), () =>
          listenPage.reportPause(7.5),
        );
      });

      await test.step("check the player stays up", async () => {
        await expect(listenPage.failedOverlay).toHaveCount(0);
        await expect(listenPage.titleHeading(MP3_BOOK.title)).toBeVisible();
      });
    });

    test("keep the player up when the progress save fails", async ({
      listenPage,
      request,
      audioFileId,
      expectMutation,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);
      const bookFileId = await audioFileId(uuid);
      const failedSave = progress.saveAudio(uuid, 12.25, bookFileId);

      // Only the save fails: the sibling `progress/get` that reconciles on
      // mount keeps hitting the real server.
      await test.step("open the player while progress saves fail", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await listenPage.forceServerError(failedSave);
      });

      await test.step("pause at 12.25 seconds", async () => {
        await expectMutation(failing(failedSave), () =>
          listenPage.reportPause(12.25),
        );
      });

      // Fire-and-forget progress uses the local cache as its safety net, not
      // the server response.
      await test.step("check the player stays up", async () => {
        await expect(listenPage.failedOverlay).toHaveCount(0);
        await expect(listenPage.titleHeading(MP3_BOOK.title)).toBeVisible();
      });
    });

    test("paint the saved position before the media element seeks (#2458)", async ({
      listenPage,
      request,
      progressRequests,
      eventClock,
    }) => {
      // RESUME_BOOK is reserved for this test: the position written below is
      // per-(user, book) server state that outlives it, and every other listen
      // test asserts a book opens at zero.
      const uuid = await fetchBookUuidByTitle(request, RESUME_BOOK.title);
      const savedSeconds = 18;

      await test.step("save a position 18 seconds in", async () => {
        const saved = await progressRequests.postAudioPosition(
          uuid,
          savedSeconds,
          eventClock.next(),
        );
        await expect(saved, "audio progress write").toBeOK();
      });

      // Without the hold, the seek lands within milliseconds on a local server
      // and the test would pass whether or not the transport was seeded. The
      // held media request never idles, so the page is not settled on.
      const release =
        await test.step("open the player while the media bytes are held", async () => {
          const release = await listenPage.holdAudioParts();
          await listenPage.gotoUnsettled(uuid);
          await listenPage.waitUntilPlayerReady();
          return release;
        });

      // Bug #2458: the scrub row read "0:00 · <full duration> remaining" for a
      // book the detail page had just offered to resume from 18 s.
      await test.step("check the transport opens at the saved position, not 0:00", async () => {
        await expect
          .poll(async () => (await listenPage.scrubStamps()).elapsed, {
            message: "transport should open at the saved position, not 0:00",
          })
          .toBeGreaterThan(0);
        const painted = await listenPage.scrubStamps();
        expect(painted.elapsed).toBe(savedSeconds);
        expect(painted.remaining).toBe(painted.total - savedSeconds);
        expect(await listenPage.seekPosition()).toBeGreaterThan(0);
      });

      // The position the element settles on is the one already on screen, so
      // the readout confirms rather than jumps.
      await test.step("release the media bytes", async () => {
        release();
        await expect
          .poll(async () => (await listenPage.scrubStamps()).elapsed, {
            message:
              "the element's own seek must not move the painted position",
          })
          .toBe(savedSeconds);
      });
    });

    // The scrubber previews on drag (`input`) but only seeks and persists on
    // release (`change`).
    test("scrub to an arbitrary position and seek only on release", async ({
      listenPage,
      request,
      expectMutation,
    }) => {
      // SCRUB_BOOK is reserved for this spec: seeking persists a position, so
      // no other spec may read it (see fixtures/audiobooks.ts).
      const uuid = await fetchBookUuidByTitle(request, SCRUB_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await expect(listenPage.seekSlider).toBeVisible();
      });

      // Scrubbing persists a per-(user, book) position, so an earlier run — or
      // a CI retry — can resume mid-way and defeat the baseline below.
      await test.step("park at the start", async () => {
        await listenPage.parkAtStart();
      });

      // About 60% in is a clear mid-book position. SCRUB_BOOK is single-part,
      // so the element's currentTime is already the absolute position.
      const target = Math.round((await listenPage.seekLength()) * 0.6);

      await test.step("drag the scrubber without releasing", async () => {
        await listenPage.previewSeek(target);
        expect(
          await listenPage.audioPosition(),
          "preview must not move the audio",
        ).toBeLessThan(1);
      });

      // MP3 seeks snap to frame boundaries, so the persisted position is the
      // target ± a frame and the body is not pinned exactly.
      await test.step("release the scrubber", async () => {
        const { request: save } = await expectMutation(progress.save(), () =>
          listenPage.releaseSeek(target),
        );
        const saved = savedAudioPosition(save);
        expect(saved.format).toBe("audio");
        expect(Math.abs(saved.seconds - target)).toBeLessThan(2);
      });

      await test.step("check the audio moved to the target", async () => {
        await expect
          .poll(async () =>
            Math.abs((await listenPage.audioPosition()) - target),
          )
          .toBeLessThan(2);
      });
    });

    test("show the target time right after a paused chapter jump (#1897)", async ({
      listenPage,
      request,
    }) => {
      // Two parts → two synthetic chapters, so a chapter-row click seeks to a
      // real, non-zero target.
      const uuid = await fetchBookUuidByTitle(
        request,
        MULTIPART_MP3_BOOK.title,
      );

      // Chapter 1 must be current for an "upcoming" row to exist to click. The
      // regression only reproduces on a seek issued while paused.
      await test.step("open the player, parked at the start and paused", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await listenPage.parkAtStart();
        await expect(listenPage.playButton).toBeVisible();
        await expect(listenPage.seekSlider).toBeVisible();
      });

      const before = await listenPage.seekPosition();

      await test.step("jump to the next chapter from the drawer", async () => {
        await listenPage.drawers.openChapters();
        await expect(listenPage.drawers.chaptersDrawer).toBeVisible();
        await listenPage.drawers.jumpToNextChapter();
      });

      // Bug #1897: without pushing the seek target into the transport display
      // immediately, the slider and elapsed readout stay at `before` until a
      // `timeupdate` — which never fires while paused. No play() call is made.
      await test.step("check the scrubber moved while still paused", async () => {
        await expect(listenPage.playButton).toBeVisible();
        await expect
          .poll(() => listenPage.seekPosition(), {
            message: "seek slider should reflect the chapter jump while paused",
          })
          .not.toBe(before);
        expect(await listenPage.seekPosition()).toBeGreaterThan(0);
      });
    });
  });

  test.describe("volume", () => {
    test("adjust the volume with the full player's slider", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await expect(listenPage.volumeSlider).toBeVisible();
        await expect(listenPage.volumeSlider).toHaveValue("1");
      });

      // The slider drives the shared `<audio>` element's volume in real time.
      await test.step("set the volume to 0.3", async () => {
        await listenPage.setVolume(0.3);
        await expect
          .poll(async () => (await listenPage.audioState())?.volume)
          .toBeCloseTo(0.3, 2);
        await expect(listenPage.volumeSlider).toHaveValue("0.3");
      });
    });
  });

  test.describe("overlay panels", () => {
    test("show the sleep panel's preset duration rail", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
      });

      await test.step("open the sleep panel", async () => {
        await listenPage.openSleepPanel();
        await expect(listenPage.sleepPanel).toBeVisible();
      });

      await test.step("check the presets run from Off to four hours", async () => {
        for (const label of [
          "Off",
          "15 min",
          "30 min",
          "45 min",
          "1 hour",
          "2 hours",
          "3 hours",
          "4 hours",
          "End of chapter",
        ]) {
          await expect(listenPage.sleepPreset(label)).toBeVisible();
        }
      });
    });

    // Regression for #2242. Neither panel has a close button, so Escape was the
    // way out, and it did nothing.
    test("dismiss the speed and sleep panels with escape", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
      });

      await test.step("dismiss the speed panel", async () => {
        await listenPage.openSpeedPanel();
        await expect(listenPage.speedPanel).toBeVisible();
        await listenPage.closePanelWithEscape();
        await expect(listenPage.speedPanel).toHaveCount(0);
      });

      await test.step("dismiss the sleep panel", async () => {
        await listenPage.openSleepPanel();
        await expect(listenPage.sleepPanel).toBeVisible();
        await listenPage.closePanelWithEscape();
        await expect(listenPage.sleepPanel).toHaveCount(0);
      });
    });

    // Both panels were laid out over the transport they belong to, covering
    // play/pause and their own trigger.
    test("keep the speed and sleep panels off play/pause and their own trigger", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
      });

      await test.step("check the speed panel leaves its controls clear", async () => {
        await listenPage.openSpeedPanel();
        await expect(listenPage.speedPanel).toBeVisible();
        expect(
          await listenPage.isCoveredBy(
            listenPage.playButton,
            listenPage.speedPanel,
          ),
        ).toBe(false);
        expect(
          await listenPage.isCoveredBy(
            listenPage.speedButton,
            listenPage.speedPanel,
          ),
        ).toBe(false);
        await listenPage.closePanelWithEscape();
      });

      await test.step("check the sleep panel leaves its controls clear", async () => {
        await listenPage.openSleepPanel();
        await expect(listenPage.sleepPanel).toBeVisible();
        expect(
          await listenPage.isCoveredBy(
            listenPage.playButton,
            listenPage.sleepPanel,
          ),
        ).toBe(false);
        expect(
          await listenPage.isCoveredBy(
            listenPage.sleepButton,
            listenPage.sleepPanel,
          ),
        ).toBe(false);
      });
    });
  });

  test.describe("sleep timer", () => {
    test("arm a sleep preset and show a live countdown", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the sleep panel", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await listenPage.openSleepPanel();
        await expect(listenPage.sleepPanel).toBeVisible();
      });

      // The countdown begins decrementing immediately, so it reads under 15 minutes.
      await test.step("arm 15 minutes", async () => {
        await listenPage.armSleep("15 min");
        await expect(listenPage.sleepStatus).toHaveText(/^1[45]:\d\d$/);
      });

      await test.step("check the toolbar button shows the countdown", async () => {
        await expect(listenPage.sleepButton).toHaveText(/^Sleep · 1[45]:/);
      });
    });

    test("stop the book at the seam when an end-of-chapter timer is armed (#2494)", async ({
      listenPage,
      request,
    }) => {
      // SLEEP_SEAM_BOOK is reserved for this test: it plays the book across a
      // seam, which writes a position and flips read status.
      const uuid = await fetchBookUuidByTitle(request, SLEEP_SEAM_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
      });

      // The fractional offset is the point: `ceil` gives a 3s countdown while
      // the playhead needs 2.1s, so the seam is crossed with the countdown above
      // zero — the race where the timer re-armed to the next chapter instead.
      await test.step("park 2.1 seconds before the seam", async () => {
        const armAt = SLEEP_SEAM_SECONDS - 2.1;
        await listenPage.seekTo(armAt);
        await expect
          .poll(() => listenPage.audioPosition())
          .toBeGreaterThan(armAt - 1);
      });

      // The panel's scrim covers the transport; clicking it dismisses the panel.
      await test.step("arm the end-of-chapter timer", async () => {
        await listenPage.openSleepPanel();
        await listenPage.armSleep("End of chapter");
        await listenPage.dismissSleepScrim();
        await expect(listenPage.sleepScrim).toHaveCount(0);
      });

      await test.step("play into the seam", async () => {
        await listenPage.play();
        await expect
          .poll(async () => (await listenPage.audioState())?.paused, {
            message: "the timer must pause the book at the chapter seam",
            timeout: 20_000,
            intervals: [150, 250, 500],
          })
          .toBe(true);
      });

      await test.step("check it stopped at the seam with the volume restored", async () => {
        const stopped = await listenPage.audioState();
        // AC1: it stopped AT the seam, not deep inside the next chapter.
        // Before the fix this read ~13s past it, still playing.
        expect(stopped?.position).toBeGreaterThan(SLEEP_SEAM_SECONDS - 1);
        expect(stopped?.position).toBeLessThan(SLEEP_SEAM_SECONDS + 1);
        // AC3/AC4: the fade ran on the way in, so the stop must put the volume
        // back. It used to strand the element at 0.033 with the readout at 100%.
        expect(stopped?.volume).toBeGreaterThan(0.9);
      });

      await test.step("check it stays stopped and disarms itself", async () => {
        await listenPage.waitOutSleepRearm();
        const later = await listenPage.audioState();
        // AC2: it does not re-arm to the following chapter.
        expect(later?.paused, "must not re-arm and play on").toBe(true);
        expect(later?.position).toBeLessThan(SLEEP_SEAM_SECONDS + 1);
        await expect(listenPage.sleepButton).toContainText(/off/i);
      });
    });
  });

  test.describe("bookmarks", () => {
    test("show the bookmarks drawer's empty state", async ({
      listenPage,
      request,
    }) => {
      // The multipart generated MP3 reaches direct-play mode reliably in
      // headless (unlike the large public-domain M4B), and no other spec
      // creates bookmarks against it, so the empty state holds on a shared DB.
      const uuid = await fetchBookUuidByTitle(
        request,
        MULTIPART_MP3_BOOK.title,
      );

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
      });

      await test.step("open the bookmarks drawer", async () => {
        await listenPage.drawers.openBookmarks();
        await expect(listenPage.drawers.bookmarksDrawer).toBeVisible();
      });

      // The copy must name the control that saves ("+ Bookmark" inside the
      // drawer), not the transport button that merely opened it (#2479).
      await test.step("check the empty state points at the add button", async () => {
        await expect(listenPage.drawers.emptyBookmarksMessage).toBeVisible();
        await expect(listenPage.drawers.addBookmarkHint).toBeVisible();
        await expect(listenPage.drawers.addBookmarkButton).toBeVisible();
      });
    });

    test("save a bookmark from the drawer and confirm it with a toast", async ({
      listenPage,
      request,
      expectMutation,
      seededBookmarkIds,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the bookmarks drawer", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await listenPage.drawers.openBookmarks();
        await expect(listenPage.drawers.bookmarksDrawer).toBeVisible();
      });

      await test.step("add a bookmark at the playhead", async () => {
        const { response } = await expectMutation(bookmarks.create(), () =>
          listenPage.drawers.addBookmark(),
        );
        const { id }: SeededBookmark = await response.json();
        seededBookmarkIds.add(id);
      });

      await test.step("check the row and the confirmation toast show", async () => {
        await expect(listenPage.drawers.firstBookmarkRow).toBeVisible();
        await expect(listenPage.drawers.savedToast).toBeVisible();
        await expect(listenPage.drawers.savedToastMessage).toBeVisible();
      });
    });
  });

  test.describe("chapters", () => {
    test("show played, current and upcoming rows in the chapters drawer", async ({
      listenPage,
      request,
    }) => {
      // The multi-part MP3 has at least two synthetic chapters (one per part):
      // the first is current at elapsed 0 and the second is upcoming. The
      // synthetic fallback gives every book at least one.
      const uuid = await fetchBookUuidByTitle(
        request,
        MULTIPART_MP3_BOOK.title,
      );
      const { drawers } = listenPage;

      await test.step("open the chapters drawer at the start of the book", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await listenPage.parkAtStart();
        await drawers.openChapters();
        await expect(drawers.chaptersDrawer).toBeVisible();
      });

      await test.step("check the first chapter is current and a later one upcoming", async () => {
        await expect(drawers.currentChapterRow).toBeVisible();
        await expect(drawers.nextChapterRow).toBeVisible();
      });

      // #2521: the playing row keeps its own book-time duration and adds the
      // time left beside it, where it used to replace one with the other and
      // leave a rate-adjusted figure unmarked in a column of book-time ones.
      await test.step("check only the playing row names its time left", async () => {
        await expect(drawers.currentChapterRow).toContainText("left");
        await expect(drawers.currentChapterRow).toHaveText(/\d+(?::\d\d)+/);
        await expect(
          drawers.nextChapterRow,
          "an upcoming row should carry a duration",
        ).toHaveText(/\d+(?::\d\d)+/);
        await expect(drawers.nextChapterRow).not.toContainText("left");
      });
    });
  });

  test.describe("buffering and stalls", () => {
    test("show a buffering badge while playing", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
      });

      // The badge is gated on `playing && buffering`, so a paused book never
      // shows it however loudly the watchdog reports. Asserting that first
      // keeps the positive case below from passing on the wrong condition.
      await test.step("report buffering while paused", async () => {
        await listenPage.reportBuffering(true);
        await expect(listenPage.bufferingBadge).toHaveCount(0);
      });

      // The watchdog's callbacks are driven directly: the point is the Rust
      // wiring and the markup contract, and a real network stall is not
      // reproducible without timing flake.
      await test.step("report playing and buffering", async () => {
        await listenPage.reportPlaying();
        await listenPage.reportBuffering(true);
      });

      // A live region, so a screen reader announces the wait rather than a
      // clock that merely looks stuck.
      await test.step("check the badge shows as a status", async () => {
        await expect(listenPage.bufferingBadge).toBeVisible();
        await expect(listenPage.bufferingBadge).toHaveText("Buffering…");
        await expect(listenPage.bufferingBadge).toHaveRole("status");
      });
    });

    test("clear the buffering badge when data arrives", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the player while it buffers", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await listenPage.reportPlaying();
        await listenPage.reportBuffering(true);
        await expect(listenPage.bufferingBadge).toBeVisible();
      });

      await test.step("report data arriving", async () => {
        await listenPage.reportBuffering(false);
      });

      await test.step("check the badge clears without claiming a failure", async () => {
        await expect(listenPage.bufferingBadge).toHaveCount(0);
        await expect(listenPage.failedOverlay).toHaveCount(0);
      });
    });

    test("show the failure overlay when playback stalls with no progress", async ({
      listenPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, MP3_BOOK.title);

      await test.step("open the player", async () => {
        await listenPage.goto(uuid);
        await listenPage.waitUntilPlayerReady();
        await expect(listenPage.failedOverlay).toHaveCount(0);
      });

      // The watchdog reports a stall after 15s without a `timeupdate`; waiting
      // that out would be a sleep and a flake source, so the callback it would
      // have fired is fired instead.
      await test.step("report a stall", async () => {
        await listenPage.reportPlaying();
        await listenPage.reportStall();
      });

      // A stall reuses `playback_failed`: the same terminal overlay as an init
      // timeout, because neither recovers without a reload.
      await test.step("check the failure overlay shows", async () => {
        await expect(listenPage.failedOverlay).toBeVisible();
        await expect(listenPage.failedOverlay).toHaveRole("alert");
        await expect(listenPage.failedOverlay).toContainText(
          "Playback failed.",
        );
      });
    });
  });
});

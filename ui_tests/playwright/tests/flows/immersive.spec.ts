// One book with both formats, auto-attached from the ebook and audiobook
// libraries; see fixtures/dual_format.ts.

import { AUDIOBOOK_BOOK_COUNT } from "../fixtures/audiobooks";
import { AUTO_ATTACHED_PAIRS, DUAL_FORMAT_BOOK } from "../fixtures/dual_format";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

test.describe("immersive read", () => {
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

  test("show the immersive read action on a dual-format book", async ({
    bookDetailPage,
    dualFormatUuid,
  }) => {
    await test.step("open the book", async () => {
      await bookDetailPage.goto(dualFormatUuid);
    });

    await test.step("check the nav and the read and listen actions show", async () => {
      await bookDetailPage.topNav.assertDisplayed();
      await expect(bookDetailPage.startReadingButton).toBeVisible();
      await expect(bookDetailPage.listenButton).toBeVisible();
    });

    // The marquee row uses the design's terser label.
    await test.step("check the immersive read action shows", async () => {
      await expect(bookDetailPage.immersiveReadButton).toBeVisible();
      await expect(bookDetailPage.immersiveReadButton).toHaveText(/Immersive/);
    });
  });

  test("open the reader with the audiobook docked", async ({
    bookDetailPage,
    epubReaderPage,
    dualFormatUuid,
  }) => {
    await test.step("open the book", async () => {
      await bookDetailPage.goto(dualFormatUuid);
    });

    // The dock retargets client state, not a request. The reader's read-status
    // write on open goes unasserted here.
    await test.step("read it immersively", async () => {
      await bookDetailPage.readImmersively();
      await epubReaderPage.assertDisplayedFor(dualFormatUuid);
    });

    // The reader has no transport, so the dock shows the listening half.
    await test.step("check the same book's audiobook is docked", async () => {
      await expect(epubReaderPage.miniDock.root).toBeVisible();
      await expect(epubReaderPage.miniDock.titleLabel).toHaveText(
        DUAL_FORMAT_BOOK.title,
      );
    });
  });

  test("stack the reader above the docked player", async ({
    bookDetailPage,
    epubReaderPage,
    dualFormatUuid,
  }) => {
    await test.step("open the book", async () => {
      await bookDetailPage.goto(dualFormatUuid);
    });

    // The reader's read-status write on open goes unasserted here.
    await test.step("read it immersively", async () => {
      await bookDetailPage.readImmersively();
      await epubReaderPage.assertDisplayedFor(dualFormatUuid);
      await expect(epubReaderPage.miniDock.root).toBeVisible();
      await expect(epubReaderPage.footerBar).toBeVisible();
    });

    // The rd-immersive reflow lands once playback resolves the book.
    await test.step("check the stage and footer clear the dock", async () => {
      await expect
        .poll(() => epubReaderPage.dockStacking(), { timeout: 10_000 })
        .toBe("clear");
    });
  });
});

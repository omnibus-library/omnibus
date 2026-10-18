// Serial: a confirmed cross-format link is per-(user, book) state every worker
// sees; the "Immersive Voyage" dual-format pair is the fixture, and
// linkedBookUuids unlinks it afterwards.

import { crossFormat } from "../contracts/crossFormat";
import { AUDIOBOOK_BOOK_COUNT } from "../fixtures/audiobooks";
import { AUTO_ATTACHED_PAIRS } from "../fixtures/dual_format";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

test.describe("cross-format sync link", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll("seed both libraries", async ({ request }) => {
    // Two sequential seed polls (ebooks then audiobooks), up to 45s each.
    test.setTimeout(120_000);
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    await seedAudiobookLibrary(
      request,
      audiobookFixturesDir(),
      FIXTURE_BOOKS.length + AUDIOBOOK_BOOK_COUNT - AUTO_ATTACHED_PAIRS,
    );
  });

  test("show the sync entry row layout for a dual-format book", async ({
    bookDetailPage,
    dualFormatUuid,
  }) => {
    await test.step("open the book", async () => {
      await bookDetailPage.goto(dualFormatUuid);
    });

    // The position is not asserted: other specs open this fixture in readers
    // and players in parallel.
    await test.step("check the unlinked entry row shows", async () => {
      await bookDetailPage.assertDisplayedFor(dualFormatUuid);
      await bookDetailPage.topNav.assertDisplayed();
      await expect(bookDetailPage.syncLink.root).toBeVisible();
      await expect(bookDetailPage.syncLink.linkFormatsButton).toBeVisible();
      await expect(bookDetailPage.syncLink.unlinkedSummary).toBeVisible();
    });
  });

  test.describe("linking", () => {
    test("link the formats and show the chip", async ({
      bookDetailPage,
      dualFormatUuid,
      linkedBookUuids,
      expectMutation,
    }) => {
      const { syncLink, alignmentModal } = bookDetailPage;

      await test.step("open the book and its alignment modal", async () => {
        await bookDetailPage.goto(dualFormatUuid);
        await syncLink.openAlignment();
        await expect(alignmentModal.root).toBeVisible();
      });

      // The fixture is a single audio file, so the simple variant renders:
      // lanes, no sequence/narrations choice.
      await test.step("check the modal offers the percentage mapping", async () => {
        await expect(alignmentModal.lanes).toBeVisible();
        await expect(alignmentModal.narrationChoice).toHaveCount(0);
        // The lone audio mark can't pair with the ebook's chapters, so the
        // mismatch state renders; the pill's counts vary with the structure
        // backfill, so only the stable tail is asserted.
        await expect(alignmentModal.lowConfidenceNote).toContainText(
          "so sync will go by percentage instead",
        );
        await expect(alignmentModal.percentagePill).toContainText(
          "no 1:1 match",
        );
        await expect(alignmentModal.syncStaysOffNote).toHaveCount(0);
        await expect(alignmentModal.confirmButton).toHaveText(
          "Sync Based Off Percentage",
        );
      });

      await test.step("confirm the link", async () => {
        await expectMutation(crossFormat.link(), () =>
          alignmentModal.confirm(),
        );
        linkedBookUuids.add(dualFormatUuid);
      });

      await test.step("check the modal closes and the linked chip shows", async () => {
        await expect(alignmentModal.root).toHaveCount(0);
        await expect(syncLink.manageButton).toBeVisible();
      });
    });

    test("unlink the formats", async ({
      bookDetailPage,
      crossFormatRequests,
      dualFormatUuid,
      linkedBookUuids,
      expectMutation,
    }) => {
      const { syncLink, alignmentModal } = bookDetailPage;

      await test.step("link the formats through the api", async () => {
        const linked = await crossFormatRequests.postLink(dualFormatUuid);
        await expect(linked, "link confirm").toBeOK();
        linkedBookUuids.add(dualFormatUuid);
      });

      await test.step("open the book and its alignment modal", async () => {
        await bookDetailPage.goto(dualFormatUuid);
        await syncLink.manageAlignment();
        await expect(alignmentModal.root).toBeVisible();
      });

      await test.step("unlink the formats", async () => {
        await expectMutation(crossFormat.unlink(), () =>
          alignmentModal.unlink(),
        );
        linkedBookUuids.delete(dualFormatUuid);
      });

      await test.step("check the entry row offers linking again", async () => {
        await expect(syncLink.linkFormatsButton).toBeVisible();
      });
    });

    test("keep sync off when the link confirm fails", async ({
      bookDetailPage,
      dualFormatUuid,
      expectMutation,
    }) => {
      const { syncLink, alignmentModal } = bookDetailPage;

      await test.step("open the book while the confirm fails", async () => {
        await bookDetailPage.goto(dualFormatUuid);
        await bookDetailPage.forceServerError(crossFormat.link());
      });

      await test.step("open the alignment modal", async () => {
        await syncLink.openAlignment();
        await expect(alignmentModal.root).toBeVisible();
      });

      await test.step("confirm the link", async () => {
        await expectMutation(failing(crossFormat.link()), () =>
          alignmentModal.confirm(),
        );
      });

      // The modal stays up with the error surfaced; sync stayed off.
      await test.step("check the error shows and cancelling leaves sync off", async () => {
        await expect(alignmentModal.errorAlert).toBeVisible();
        await alignmentModal.cancel();
        await expect(syncLink.linkFormatsButton).toBeVisible();
      });
    });
  });
});

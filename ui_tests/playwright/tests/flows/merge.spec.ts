import { type MergeResult, merge } from "../contracts/merge";
import { AUDIOBOOK_BOOK_COUNT, MERGE_PRIMARY } from "../fixtures/audiobooks";
import { AUTO_ATTACHED_PAIRS } from "../fixtures/dual_format";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import {
  audiobookFixturesDir,
  fixturesDir,
  seedAudiobookLibrary,
  seedLibrary,
} from "../utils/seed";

// A leaked merge would re-attach on a later reindex and corrupt other specs'
// format counts, so `mergeLock` undoes every merge before the next writer.
test.describe.configure({ mode: "serial" });

// The merge-only MP3 audiobook is read by no other spec, and its title and
// author match no EPUB, so auto-attach stays out of the way.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;
const SOURCE = MERGE_PRIMARY;

test.describe("book merge", () => {
  // One fixture pair ("Immersive Voyage") auto-attaches into a single
  // dual-format book, so the combined total is the sum less that pair.
  test.beforeAll("seed both libraries", async ({ request }) => {
    // Two seed polls of up to 45s each outlast the default timeout.
    test.setTimeout(120_000);
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    await seedAudiobookLibrary(
      request,
      audiobookFixturesDir(),
      FIXTURE_BOOKS.length + AUDIOBOOK_BOOK_COUNT - AUTO_ATTACHED_PAIRS,
    );
  });

  test("show the merge affordance layout", async ({
    request,
    bookDetailPage,
  }) => {
    const { mergeDialog } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the ebook", async () => {
      await bookDetailPage.goto(uuid);
    });

    await test.step("check the rail offers an admin merge", async () => {
      await bookDetailPage.assertDisplayed();
      await bookDetailPage.topNav.assertDisplayed();
      await expect(bookDetailPage.editMetadataLink).toBeVisible();
      await expect(mergeDialog.openButton).toBeVisible();
    });

    await test.step("open the merge dialog", async () => {
      await mergeDialog.open();
      await expect(mergeDialog.dialog).toBeVisible();
      await expect(mergeDialog.searchField).toBeVisible();
    });

    await test.step("cancel the dialog", async () => {
      await mergeDialog.cancel();
      await expect(mergeDialog.searchField).not.toBeVisible();
    });
  });

  test("keep the book unchanged when the merge fails", async ({
    request,
    bookDetailPage,
    expectMutation,
  }) => {
    const { mergeDialog } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the ebook while merges fail", async () => {
      await bookDetailPage.goto(uuid);
      await bookDetailPage.forceServerError(merge.books());
    });

    await test.step("pick the audiobook to merge in", async () => {
      await mergeDialog.chooseSource(SOURCE.title);
      await expect(mergeDialog.confirmButton).toBeVisible();
    });

    await test.step("confirm the merge", async () => {
      await expectMutation(failing(merge.books()), () => mergeDialog.confirm());
    });

    // The marquee files stop lists a book's formats as one copies row, and
    // one badge tile, per format.
    await test.step("check the dialog shows the error and the book is unchanged", async () => {
      await expect(mergeDialog.errorAlert).toBeVisible();
      await mergeDialog.cancel();
      await expect(bookDetailPage.formatBadges).toHaveCount(1);
      await expect(bookDetailPage.formatBadges).toHaveAttribute(
        "aria-label",
        "EPUB",
      );
    });
  });

  test.describe("holding the audiobook lock", () => {
    // The lock is taken before the test body runs, so it can wait out other
    // specs' merges for longer than the default timeout.
    test.slow();

    test("merge an audiobook into an ebook", async ({
      request,
      bookDetailPage,
      mergeLock,
      expectMutation,
    }) => {
      const { mergeDialog } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the ebook", async () => {
        await bookDetailPage.goto(uuid);
      });

      await test.step("pick the audiobook to merge in", async () => {
        await mergeDialog.open();
        await mergeDialog.search(SOURCE.title);
        await mergeDialog.assertCandidatesListed();
        await mergeDialog.pickFirstCandidate();
        await expect(mergeDialog.confirmButton).toBeVisible();
      });

      await test.step("confirm the merge", async () => {
        const { response } = await expectMutation(merge.books(), () =>
          mergeDialog.confirm(),
        );
        const { merge_log_id }: MergeResult = await response.json();
        mergeLock.undoAfter(merge_log_id);
      });

      // The refetch lands with a copies row per format, both CTAs, and the toast.
      await test.step("check the book gains the audio format", async () => {
        await expect(bookDetailPage.formatBadges).toHaveCount(2);
        await expect(
          bookDetailPage.formatRow(SOURCE.format).root,
        ).toBeVisible();
        await expect(bookDetailPage.startReadingButton).toBeVisible();
        await expect(bookDetailPage.listenButton).toBeVisible();
        await expect(mergeDialog.mergedToast).toBeVisible();
      });
    });

    test("undo a merge from its toast", async ({
      request,
      bookDetailPage,
      mergeLock,
      expectMutation,
    }) => {
      const { mergeDialog } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      // The toast is client state, so a merge made through the api has none.
      const mergeLogId = await test.step("merge the audiobook in", async () => {
        await bookDetailPage.goto(uuid);
        await mergeDialog.chooseSource(SOURCE.title);
        const { response } = await expectMutation(merge.books(), () =>
          mergeDialog.confirm(),
        );
        const { merge_log_id }: MergeResult = await response.json();
        mergeLock.undoAfter(merge_log_id);
        await expect(mergeDialog.mergedToast).toBeVisible();
        return merge_log_id;
      });

      await test.step("undo the merge from the toast", async () => {
        await expectMutation(merge.undo(), () => mergeDialog.undo());
        mergeLock.undone(mergeLogId);
      });

      await test.step("check the formats are split again", async () => {
        await expect(bookDetailPage.formatBadges).toHaveCount(1);
        await expect(bookDetailPage.formatBadges).toHaveAttribute(
          "aria-label",
          "EPUB",
        );
        await expect(bookDetailPage.listenButton).not.toBeVisible();
      });
    });
  });
});

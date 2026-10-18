import { adminHealth } from "../contracts/adminHealth";
import { buildAdminHealthReport } from "../data/adminHealth";
import { expect, test } from "../fixtures/pageFixtures";

// The layout test reads the real endpoint. The live-update test stubs it, so a
// change can only come from its second poll and not from a parallel spec.

test.describe("admin health page", () => {
  test("show the admin health layout", async ({
    adminHealthPage,
    expectMutation,
  }) => {
    await test.step("open the admin health page", async () => {
      await expectMutation(adminHealth.poll(), () => adminHealthPage.goto());
    });

    await test.step("check the report's cards show", async () => {
      await adminHealthPage.assertDisplayed();
      await expect(adminHealthPage.grid).toBeVisible();

      await expect(adminHealthPage.indexHeading).toBeVisible();
      await expect(adminHealthPage.indexCard).toContainText("Books indexed");
      await expect(adminHealthPage.indexCard).toContainText("Authors indexed");
      await expect(adminHealthPage.indexCard).toContainText("Series indexed");

      await expect(adminHealthPage.workerHeading).toBeVisible();
      // A parallel spec's scan may or may not be running, so either state is valid.
      await expect(
        adminHealthPage.workerEmpty.or(adminHealthPage.workerTable),
      ).toBeVisible();

      await expect(adminHealthPage.ftsHeading).toBeVisible();
      await expect(adminHealthPage.ftsCard).toContainText("Books rows");
      await expect(adminHealthPage.ftsCard).toContainText("FTS rows");

      await expect(adminHealthPage.storageHeading).toBeVisible();
      await expect(adminHealthPage.storageCard).toContainText(
        "Library content",
      );
      await expect(adminHealthPage.storageCard).toContainText(
        "Thumbnail cache",
      );

      await expect(adminHealthPage.errorsHeading).toBeVisible();
      await expect(
        adminHealthPage.errorsEmpty.or(adminHealthPage.errorsTable),
      ).toBeVisible();

      await adminHealthPage.topNav.assertDisplayed();
    });
  });

  test("update the index stats and worker queue after a poll tick", async ({
    adminHealthPage,
  }) => {
    const before = buildAdminHealthReport();
    // The analog of a scan landing: the book count jumps, a ghosted book turns
    // up and a running scan joins the worker queue.
    const after = buildAdminHealthReport({
      index: { ...before.index, book_count: 47, ghosted_book_count: 3 },
      worker_queue: [
        { kind: "scan", queue_depth: 1, recent_completions_ms: [] },
      ],
    });

    await test.step("open the page with a small library", async () => {
      await adminHealthPage.stubReport(before);
      await adminHealthPage.goto();
    });

    await test.step("check the first report shows", async () => {
      await expect(adminHealthPage.booksIndexed).toHaveText("12");
      await expect(adminHealthPage.ghostedOk).toBeVisible();
      await expect(adminHealthPage.workerEmpty).toBeVisible();
    });

    await test.step("let the next poll bring a changed report", async () => {
      await adminHealthPage.serveReport(after);
    });

    await test.step("check the page shows it without navigating", async () => {
      await expect(adminHealthPage.booksIndexed).toHaveText("47");
      await expect(adminHealthPage.ghostedWarning).toBeVisible();
      await expect(adminHealthPage.ghostedWarning).toContainText(
        "3 book(s) have no file on disk",
      );
      await expect(adminHealthPage.workerRow).toBeVisible();
      await expect(adminHealthPage.workerRow).toContainText("Scanning library");
      await adminHealthPage.assertDisplayed();
    });
  });
});

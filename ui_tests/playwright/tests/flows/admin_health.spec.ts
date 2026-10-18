import { adminHealth } from "../contracts/adminHealth";
import { buildAdminHealthReport } from "../data/adminHealth";
import { expect, test } from "../fixtures/pageFixtures";

// The layout test reads the real endpoint. The live-update test stubs it, so a
// change can only come from its second poll and not from a parallel spec.

test.describe("health section", () => {
  test("show the health section layout", async ({
    adminPage,
    expectMutation,
  }) => {
    const { health } = adminPage;

    await test.step("open the health section", async () => {
      await expectMutation(adminHealth.poll(), () => adminPage.goto("health"));
    });

    await test.step("check the report's cards show", async () => {
      await adminPage.assertDisplayedFor("health");
      await expect(health.heading).toBeVisible();
      await expect(adminPage.sectionLink("health")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(health.grid).toBeVisible();

      await expect(health.indexHeading).toBeVisible();
      await expect(health.indexCard).toContainText("Books indexed");
      await expect(health.indexCard).toContainText("Authors indexed");
      await expect(health.indexCard).toContainText("Series indexed");

      await expect(health.workerHeading).toBeVisible();
      // A parallel spec's scan may or may not be running, so either state is valid.
      await expect(health.workerEmpty.or(health.workerTable)).toBeVisible();

      await expect(health.ftsHeading).toBeVisible();
      await expect(health.ftsCard).toContainText("Books rows");
      await expect(health.ftsCard).toContainText("FTS rows");

      await expect(health.storageHeading).toBeVisible();
      await expect(health.storageCard).toContainText("Library content");
      await expect(health.storageCard).toContainText("Thumbnail cache");

      await expect(health.errorsHeading).toBeVisible();
      await expect(health.errorsEmpty.or(health.errorsTable)).toBeVisible();

      await adminPage.topNav.assertDisplayed();
    });
  });

  test("update the index stats and worker queue after a poll tick", async ({
    adminPage,
  }) => {
    const { health } = adminPage;
    const before = buildAdminHealthReport();
    // The analog of a scan landing: the book count jumps, a ghosted book turns
    // up and a running scan joins the worker queue.
    const after = buildAdminHealthReport({
      index: { ...before.index, book_count: 47, ghosted_book_count: 3 },
      worker_queue: [
        { kind: "scan", queue_depth: 1, recent_completions_ms: [] },
      ],
    });

    await test.step("open the section with a small library", async () => {
      await health.stubReport(before);
      await adminPage.goto("health");
    });

    await test.step("check the first report shows", async () => {
      await expect(health.booksIndexed).toHaveText("12");
      await expect(health.ghostedOk).toBeVisible();
      await expect(health.workerEmpty).toBeVisible();
    });

    await test.step("let the next poll bring a changed report", async () => {
      await health.serveReport(after);
    });

    await test.step("check the section shows it without navigating", async () => {
      await expect(health.booksIndexed).toHaveText("47");
      await expect(health.ghostedWarning).toBeVisible();
      await expect(health.ghostedWarning).toContainText(
        "3 books have no file on disk",
      );
      await expect(health.workerRow).toBeVisible();
      await expect(health.workerRow).toContainText("Scanning library");
      await adminPage.assertDisplayedFor("health");
    });
  });

  test("link a captured error to its book and name its file", async ({
    adminPage,
  }) => {
    const { health } = adminPage;
    const bookUuid = "00000000-0000-4000-8000-000000000001";

    await test.step("open the section with one captured error", async () => {
      await health.stubReport(
        buildAdminHealthReport({
          last_errors: [
            {
              timestamp: 1_700_000_000,
              target: "omnibus::scanner",
              message: "unreadable epub",
              book_uuid: bookUuid,
              file: "/data/ebooks/broken.epub",
            },
          ],
        }),
      );
      await adminPage.goto("health");
    });

    await test.step("check the error links its book and names its file", async () => {
      await expect(health.errorsRowBookLink).toHaveAttribute(
        "href",
        `/books/${bookUuid}`,
      );
      await expect(health.errorsRowFile).toHaveText("/data/ebooks/broken.epub");
    });
  });

  test("redirect the legacy health route into the health section", async ({
    adminPage,
  }) => {
    await test.step("open the old address", async () => {
      await adminPage.gotoLegacy("/admin/health");
    });

    await test.step("check the health section shows", async () => {
      await adminPage.assertDisplayedFor("health");
      await expect(adminPage.health.root).toBeVisible();
    });
  });
});

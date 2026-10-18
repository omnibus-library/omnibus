import { logs } from "../contracts/logs";
import { buildLogPage } from "../data/logs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// The layout test reads the real on-disk logs; the rest stub the read after the
// first load so the rows they assert on are fixed.

test.describe("logs section", () => {
  test("show the logs layout", async ({ settingsPage, expectMutation }) => {
    const { logs: section } = settingsPage;

    // The page reads the logs on mount, as a POST because the read carries a query.
    await test.step("open the logs section", async () => {
      await expectMutation(logs.read(), () => settingsPage.goto("logs"));
    });

    await test.step("check the filters and the real records show", async () => {
      await expect(section.heading).toBeVisible();
      await expect(settingsPage.sectionLink("logs")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(section.levelFilter).toBeVisible();
      await expect(section.moduleFilter).toBeVisible();
      await expect(section.fromField).toBeVisible();
      await expect(section.toField).toBeVisible();
      await expect(section.applyButton).toBeVisible();
      // The server logs its own requests, so the real logs are never empty.
      await expect(section.table).toBeVisible();
      await expect(section.firstRow).toBeVisible();
      await settingsPage.topNav.assertDisplayed();
    });
  });

  test("filter the logs by level", async ({ settingsPage, expectMutation }) => {
    const { logs: section } = settingsPage;

    await test.step("open the logs section", async () => {
      await settingsPage.goto("logs");
    });

    await test.step("pick the error level", async () => {
      await section.stubLogs(
        buildLogPage([
          {
            level: "ERROR",
            target: "omnibus_db::worker::queue",
            message: "worker: task failed",
          },
        ]),
      );
      await section.selectLevel("ERROR");
    });

    await test.step("apply the filter", async () => {
      await expectMutation(logs.read({ level: "ERROR" }), () =>
        section.apply(),
      );
    });

    await test.step("check only the error record shows", async () => {
      await expect(section.rows).toHaveCount(1);
      await expect(section.firstRow).toContainText("worker: task failed");
      await expect(section.levelText("ERROR")).toBeVisible();
    });
  });

  test("filter the logs by module", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { logs: section } = settingsPage;

    await test.step("open the logs section", async () => {
      await settingsPage.goto("logs");
    });

    await test.step("type a module", async () => {
      await section.stubLogs(
        buildLogPage([
          {
            level: "INFO",
            target: "omnibus::backend::covers",
            message: "served cover",
          },
        ]),
      );
      await section.filterModule("omnibus::backend");
    });

    await test.step("apply the filter", async () => {
      await expectMutation(logs.read({ module: "omnibus::backend" }), () =>
        section.apply(),
      );
    });

    await test.step("check only the module's record shows", async () => {
      await expect(section.rows).toHaveCount(1);
      await expect(section.firstRow).toContainText("omnibus::backend::covers");
    });
  });

  test("page through older and newer records", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { logs: section } = settingsPage;

    await test.step("open the logs section", async () => {
      await settingsPage.goto("logs");
    });

    // Page 0 has a further page and page 1 is the last, so each shows its own row.
    await test.step("apply with no filters to land on the first page", async () => {
      await section.stubLogs((requestedPage) =>
        requestedPage >= 1
          ? buildLogPage(
              [{ level: "INFO", target: "a", message: "older-record" }],
              { page: 1 },
            )
          : buildLogPage(
              [{ level: "INFO", target: "a", message: "newer-record" }],
              { page: 0, hasMore: true },
            ),
      );
      await expectMutation(logs.read(), () => section.apply());
      await expect(section.pageIndicator).toHaveText("Page 1");
      await expect(section.newerButton).toBeDisabled();
      await expect(section.firstRow).toContainText("newer-record");
    });

    await test.step("go to older records", async () => {
      await expectMutation(logs.read({ page: 1 }), () => section.showOlder());
      await expect(section.pageIndicator).toHaveText("Page 2");
      await expect(section.newerButton).toBeEnabled();
      await expect(section.olderButton).toBeDisabled();
      await expect(section.firstRow).toContainText("older-record");
    });

    await test.step("go back to newer records", async () => {
      await expectMutation(logs.read({ page: 0 }), () => section.showNewer());
      await expect(section.pageIndicator).toHaveText("Page 1");
      await expect(section.newerButton).toBeDisabled();
      await expect(section.firstRow).toContainText("newer-record");
    });
  });

  // `require_auth` must turn it away before any log is read.
  test("reject an unauthenticated log request", async ({
    anonymousLogViewerRequests,
  }) => {
    const response = await anonymousLogViewerRequests.postLogs({
      page: 0,
      per_page: 5,
    });

    expect(response.status()).toBe(401);
  });

  test("show an error when the log read fails", async ({
    settingsPage,
    expectMutation,
  }) => {
    const { logs: section } = settingsPage;
    const read = logs.read();

    await test.step("open the logs section", async () => {
      await settingsPage.goto("logs");
      await settingsPage.forceServerError(read);
    });

    await test.step("apply the filters", async () => {
      await expectMutation(failing(read), () => section.apply());
    });

    await test.step("check the viewer reports the failure", async () => {
      await expect(section.error).toBeVisible();
      await expect(section.error).toContainText("Failed to load logs");
    });
  });

  test("open the logs from the sidebar", async ({ settingsPage }) => {
    const { logs: section } = settingsPage;

    await test.step("open settings", async () => {
      await settingsPage.goto();
    });

    await test.step("open the logs item", async () => {
      await settingsPage.openSection("logs");
    });

    await test.step("check the viewer shows", async () => {
      await settingsPage.assertSectionOpen("logs");
      await expect(section.heading).toBeVisible();
      await expect(section.root).toBeVisible();
    });
  });

  test("redirect the legacy logs route into the logs section", async ({
    settingsPage,
  }) => {
    const { logs: section } = settingsPage;

    await test.step("open the old address", async () => {
      await settingsPage.gotoLegacyLogs();
    });

    await test.step("check the logs section shows", async () => {
      await settingsPage.assertSectionOpen("logs");
      await expect(section.heading).toBeVisible();
    });
  });
});

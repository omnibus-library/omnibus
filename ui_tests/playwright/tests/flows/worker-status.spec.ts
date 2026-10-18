import { buildScanTask, type WorkerStatus } from "../data/workerStatus";
import { expect, test } from "../fixtures/pageFixtures";

// The poll is stubbed, so no test waits on a real scan and each render branch
// (idle, active, done, failed) can be forced.

const idle: WorkerStatus = { active: [], recent_complete: [] };

test.describe("worker status indicator", () => {
  test("hide the indicator when the worker is idle", async ({ adminPage }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section while the worker is idle", async () => {
      await workerStatus.stubStatus(idle);
      await adminPage.goto("maintenance");
    });

    await test.step("check no indicator renders", async () => {
      await expect(workerStatus.indicator).toHaveCount(0);
    });
  });

  test("show an active scan", async ({ adminPage }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section during a scan", async () => {
      await workerStatus.stubStatus({
        active: [
          buildScanTask({
            task_id: 1,
            state: { state: "running", processed: 0, total: null },
            resource_key: "/tmp/lib",
          }),
        ],
        recent_complete: [],
      });
      await adminPage.goto("maintenance");
    });

    await test.step("check the indicator names the scan", async () => {
      await expect(workerStatus.indicator).toBeVisible();
      await expect(workerStatus.indicator).toContainText("Scanning library");
    });
  });

  test("show processed and total when the total is known", async ({
    adminPage,
  }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section during a scan with a known total", async () => {
      await workerStatus.stubStatus({
        active: [
          buildScanTask({
            task_id: 2,
            state: { state: "running", processed: 3, total: 10 },
          }),
        ],
        recent_complete: [],
      });
      await adminPage.goto("maintenance");
    });

    await test.step("check the indicator shows the progress", async () => {
      await expect(workerStatus.indicator).toContainText("Scanning library");
      await expect(workerStatus.indicator).toContainText("(3 / 10)");
    });
  });

  test("show the activity panel for a scan", async ({ adminPage }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section during a verbose scan", async () => {
      await workerStatus.stubStatus({
        active: [
          buildScanTask({
            task_id: 7,
            state: { state: "running", processed: 3, total: 10 },
            detail: {
              phase: "Reading file metadata",
              current_item: "books/Bram Stoker/Dracula.epub",
              tallies: {
                found: 340,
                new: 3,
                changed: 1,
                removed: 2,
                moved: 0,
                unchanged: 334,
              },
            },
          }),
        ],
        recent_complete: [],
      });
      await adminPage.goto("maintenance");
    });

    await test.step("check the panel shows the phase, item and tallies", async () => {
      await expect(workerStatus.indicator).toContainText("Scanning library");
      await expect(workerStatus.phase).toHaveText("Reading file metadata");
      await expect(workerStatus.currentItem).toHaveText(
        "books/Bram Stoker/Dracula.epub",
      );
      await expect(workerStatus.tallies).toHaveText(
        "Found 340 — 3 new · 1 changed · 2 removed",
      );
    });
  });

  test("summarize a finished scan's tallies", async ({ adminPage }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section after a scan", async () => {
      await workerStatus.stubStatus({
        active: [],
        recent_complete: [
          buildScanTask({
            task_id: 8,
            state: { state: "done", processed: 4 },
            detail: {
              tallies: {
                found: 12,
                new: 3,
                changed: 1,
                removed: 0,
                moved: 0,
                unchanged: 8,
              },
            },
            started_at_ms: Date.now() - 2_000,
          }),
        ],
      });
      await adminPage.goto("maintenance");
    });

    await test.step("check the row summarizes the tallies", async () => {
      await expect(workerStatus.indicator).toContainText("Library scan");
      await expect(workerStatus.summary).toHaveText("3 new · 1 changed");
    });
  });

  test("show a finished scan once the active one completes", async ({
    adminPage,
  }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section during a scan", async () => {
      await workerStatus.stubStatus({
        active: [
          buildScanTask({
            task_id: 3,
            state: { state: "running", processed: 0, total: null },
          }),
        ],
        recent_complete: [],
      });
      await adminPage.goto("maintenance");
      await expect(workerStatus.indicator).toContainText("Scanning library");
    });

    await test.step("let the scan finish", async () => {
      workerStatus.changeStatus({
        active: [],
        recent_complete: [
          buildScanTask({
            task_id: 3,
            state: { state: "done", processed: 12 },
            started_at_ms: Date.now() - 1_000,
          }),
        ],
      });
    });

    // The next poll is a second off; the rest is slack for slow runners.
    await test.step("check the row reads as finished", async () => {
      await expect(workerStatus.indicator).toContainText("Library scan", {
        timeout: 3_500,
      });
    });
  });

  test("dismiss a finished scan", async ({ adminPage }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section during a scan", async () => {
      await workerStatus.stubStatus({
        active: [
          buildScanTask({
            task_id: 3,
            state: { state: "running", processed: 0, total: null },
          }),
        ],
        recent_complete: [],
      });
      await adminPage.goto("maintenance");
      await expect(workerStatus.indicator).toContainText("Scanning library");
    });

    await test.step("let the scan finish", async () => {
      workerStatus.changeStatus({
        active: [],
        recent_complete: [
          buildScanTask({
            task_id: 3,
            state: { state: "done", processed: 12 },
            started_at_ms: Date.now() - 1_000,
          }),
        ],
      });
      await expect(workerStatus.indicator).toContainText("Library scan", {
        timeout: 3_500,
      });
    });

    await test.step("dismiss the finished row", async () => {
      await workerStatus.dismiss();
    });

    // Nothing is active and the only finished row is suppressed client-side.
    await test.step("check the indicator collapses", async () => {
      await expect(workerStatus.indicator).toHaveCount(0);
    });
  });

  test("show a failed scan with its error message", async ({ adminPage }) => {
    const { workerStatus } = adminPage;

    await test.step("open the maintenance section after a failed scan", async () => {
      await workerStatus.stubStatus({
        active: [],
        recent_complete: [
          buildScanTask({
            task_id: 4,
            state: { state: "failed", message: "library path does not exist" },
            started_at_ms: Date.now() - 500,
          }),
        ],
      });
      await adminPage.goto("maintenance");
    });

    await test.step("check the alert gives the reason", async () => {
      await expect(workerStatus.failureAlert).toBeVisible();
      await expect(workerStatus.failureAlert).toContainText(
        "Library scan failed",
      );
      await expect(workerStatus.failureAlert).toContainText(
        "library path does not exist",
      );
    });
  });
});

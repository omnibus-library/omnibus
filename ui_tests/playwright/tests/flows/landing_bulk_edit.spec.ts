import type { Locator, Page } from "@playwright/test";

import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { fetchBookIdByTitle, switchToTableView } from "../utils/ebooks";
import { gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";
import { galleryTile, withManualShelf } from "../utils/shelves";

// Table-view bulk edit: row checkboxes → floating action bar → modal →
// one `rpc_bulk_save_overrides` call for every selected book.
//
// The two `bulk-target-*` fixtures are reserved for this spec (see the
// comment in fixtures/epubs.ts) — the happy-path test bulk-writes overrides
// to BOTH and reverts them at the end, and the suite is fullyParallel, so
// nothing else may read them. The shelf tests file both on shelves they make.

test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

const TARGETS = FIXTURE_BOOKS.filter((b) => b.slug.startsWith("bulk-target-"));
const [PRIMARY, SECONDARY] = [TARGETS[0]!, TARGETS[1]!];

/** The selection checkbox in a target's table row. */
function selectBox(page: Page, target: (typeof TARGETS)[number]): Locator {
  return page
    .getByTestId(`ebook-row-${target.slug}`)
    .getByTestId("ebook-select");
}

/** Check both target rows' selection checkboxes. */
async function selectTargets(page: Page) {
  for (const target of [PRIMARY, SECONDARY]) {
    await selectBox(page, target).check();
  }
}

test("renders the bulk edit layout: checkboxes, select-all, and no bar while nothing is selected", async ({
  page,
}) => {
  await gotoReady(page, "/");
  await switchToTableView(page);

  await expect(page.getByTestId("ebook-select-all")).toBeVisible();
  for (const target of [PRIMARY, SECONDARY]) {
    await expect(
      page.getByTestId(`ebook-row-${target.slug}`).getByTestId("ebook-select"),
    ).toBeVisible();
  }
  await expect(page.getByTestId("bulk-edit-bar")).toHaveCount(0);
});

test("selecting rows reveals the bulk edit bar and checkbox clicks do not navigate", async ({
  page,
}) => {
  await gotoReady(page, "/");
  await switchToTableView(page);

  await selectTargets(page);
  // The checkbox cell stops propagation — the row's click-to-navigate
  // handler must not fire.
  await expect(page).toHaveURL(/\/$/);

  const bar = page.getByTestId("bulk-edit-bar");
  await expect(bar).toContainText("2 books selected");
  // The bar flattens into the landing column, where `.lmq > *` lifts each
  // section — a rule that ties the bar on specificity. Losing that tie drops
  // it into the flow, far below the rows it reports on.
  await expect
    .poll(() => bar.evaluate((el) => getComputedStyle(el).position))
    .toBe("fixed");

  await page.getByTestId("bulk-edit-clear").click();
  await expect(bar).toHaveCount(0);
});

test("select all toggles every visible row", async ({ page }) => {
  await gotoReady(page, "/");
  await switchToTableView(page);

  const selectAll = page.getByTestId("ebook-select-all");
  await selectAll.check();
  const rowCount = await page.getByTestId("ebook-select").count();
  await expect(page.getByTestId("bulk-edit-bar")).toContainText(
    `${rowCount} books selected`,
  );

  await selectAll.uncheck();
  await expect(page.getByTestId("bulk-edit-bar")).toHaveCount(0);
});

test("bulk edits publisher and tags across the selected books via rpc_bulk_save_overrides", async ({
  page,
  request,
}) => {
  await gotoReady(page, "/");
  await switchToTableView(page);

  await selectTargets(page);
  await page.getByTestId("bulk-edit-open").click();

  const modal = page.getByTestId("bulk-edit-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Edit 2 books");

  await modal.getByLabel("Publisher").fill("Bulk Edited Press");
  await modal.getByTestId("bulk-add-tags-input").fill("bulk-tagged");
  await modal.getByTestId("bulk-add-tags-input").press("Enter");

  await expectMutation(
    page,
    {
      method: "POST",
      url: /\/api\/rpc\/ebook\/overrides\/bulk$/,
      expectedStatus: 200,
    },
    async () => page.getByTestId("bulk-edit-submit").click(),
  );

  // Modal and bar close; the rows re-render from the returned metadata —
  // the added tag lands in each row's Tags cell (publisher has no table
  // column; it's covered by the request/response contract above).
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("bulk-edit-bar")).toHaveCount(0);
  for (const target of [PRIMARY, SECONDARY]) {
    await expect(
      page
        .getByTestId(`ebook-row-${target.slug}`)
        .getByTestId("ebook-cell-tags"),
    ).toContainText("bulk-tagged");
  }

  // Cleanup: revert both books' overrides so subsequent runs start from
  // pristine fixture state. Assert each delete succeeds — a silent failure
  // would leak the override across the suite.
  for (const target of [PRIMARY, SECONDARY]) {
    const uuid = await fetchBookIdByTitle(request, target.title);
    const revertResp = await request.post(`/api/rpc/ebook/overrides/delete`, {
      data: { uuid },
    });
    expect(
      revertResp.status(),
      `cleanup revert for ${target.slug} must succeed`,
    ).toBe(200);
  }
});

test("bulk edit save error keeps the modal open and the rows unchanged", async ({
  page,
}) => {
  await gotoReady(page, "/");
  await switchToTableView(page);

  await selectTargets(page);
  await page.getByTestId("bulk-edit-open").click();
  const modal = page.getByTestId("bulk-edit-modal");
  await modal.getByLabel("Publisher").fill("Should Not Persist");
  await modal.getByTestId("bulk-add-tags-input").fill("should-not-persist");
  await modal.getByTestId("bulk-add-tags-input").press("Enter");

  await page.route("**/api/rpc/ebook/overrides/bulk", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      });
    }
    return route.continue();
  });

  await expectMutation(
    page,
    {
      method: "POST",
      url: /\/api\/rpc\/ebook\/overrides\/bulk$/,
      expectedStatus: 500,
    },
    async () => page.getByTestId("bulk-edit-submit").click(),
  );
  await page.unroute("**/api/rpc/ebook/overrides/bulk");

  // The modal surfaces the failure and stays open; nothing was written —
  // the rejected tag never reaches the rows' Tags cells.
  await expect(page.getByTestId("bulk-edit-error")).toBeVisible();
  await expect(page.getByTestId("bulk-edit-modal")).toBeVisible();
  for (const target of [PRIMARY, SECONDARY]) {
    await expect(
      page
        .getByTestId(`ebook-row-${target.slug}`)
        .getByTestId("ebook-cell-tags"),
    ).not.toContainText("should-not-persist");
  }
});

test("add the selected books to a hand-picked shelf in one request", async ({
  page,
  request,
}) => {
  const uuids = await Promise.all(
    [PRIMARY, SECONDARY].map((t) => fetchBookIdByTitle(request, t.title)),
  );
  await withManualShelf(request, "E2E Bulk Shelf", async ({ id }) => {
    await gotoReady(page, "/");
    await switchToTableView(page);
    await selectTargets(page);
    await page.getByTestId("bulk-add-to-shelf").click();

    const picker = page.getByTestId("shelf-picker");
    await expect(
      picker.getByRole("heading", { name: "Add 2 books to a shelf" }),
    ).toBeVisible();
    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/add-books",
        expectedBody: { id, book_uuids: [...uuids].sort() },
        expectedStatus: 200,
      },
      async () => picker.getByTestId(`shelf-picker-row-${id}`).click(),
    );

    // Picker and bar close, the selection is gone, and the gallery's count
    // follows without a reload.
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId("bulk-edit-bar")).toHaveCount(0);
    await expect(galleryTile(page, id)).toContainText("2 books");
    for (const target of [PRIMARY, SECONDARY]) {
      await expect(selectBox(page, target)).not.toBeChecked();
    }
  });
});

test("keep the selection when adding to a shelf fails", async ({
  page,
  request,
}) => {
  const uuids = await Promise.all(
    [PRIMARY, SECONDARY].map((t) => fetchBookIdByTitle(request, t.title)),
  );
  await withManualShelf(request, "E2E Bulk Shelf", async ({ id }) => {
    await gotoReady(page, "/");
    await switchToTableView(page);
    await selectTargets(page);
    await page.getByTestId("bulk-add-to-shelf").click();

    await page.route("**/api/rpc/shelves/add-books", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      }),
    );
    const picker = page.getByTestId("shelf-picker");
    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/add-books",
        expectedBody: { id, book_uuids: [...uuids].sort() },
        expectedStatus: 500,
      },
      async () => picker.getByTestId(`shelf-picker-row-${id}`).click(),
    );
    await page.unroute("**/api/rpc/shelves/add-books");

    await expect(page.getByTestId("shelf-picker-error")).toBeVisible();
    await expect(picker).toBeVisible();
    await expect(page.getByTestId("bulk-edit-bar")).toContainText(
      "2 books selected",
    );

    await page.getByTestId("shelf-picker-close").click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId("bulk-edit-bar")).toContainText(
      "2 books selected",
    );
  });
});

import type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
} from "@playwright/test";

import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { expectNavVisible, gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";
import { withManualShelf, withOwnShelf } from "../utils/shelves";
import { logInThroughUi, provisionUser } from "../utils/users";

// The book page's More stop shows every shelf holding the book as a tile, and
// "Add to shelf" opens a picker that files this book on a hand-picked shelf, or
// takes it off, without leaving the page.
//
// `standalone-forest` is reserved for this spec (see the comment in
// fixtures/epubs.ts). The suite is fullyParallel, so tests here may hold the
// book on different shelves at once: each one makes a shelf of its own and
// asserts only about that shelf, never about the book's whole shelf list.
//
// Scroll stops is a per-account preference that changes the page's layout (see
// 04a), so the tests that depend on it run as readers of their own, one per
// layout, and never touch the shared admin's switch.

test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-forest")!;

// Only read: the series test opens its More stop and writes nothing.
const SERIES_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;

// One unbroken run far wider than a picker tile: it fits only by breaking
// mid-word.
const LONG_SHELF_LABEL = "W".repeat(90);

const READER_PASSWORD = "shelf-reader-pw-00";
const SNAP_READER = "shelfsnap";
const FLOW_READER = "shelfflow";

/**
 * Run `body` against a fresh private smart shelf matching any of `rules` (see
 * `withOwnShelf`). Pick rules no other spec's books match.
 */
function withSmartShelf(
  request: APIRequestContext,
  label: string,
  rules: { field: string; op: string; value: string }[],
  body: (shelf: { id: number; name: string }) => Promise<void>,
): Promise<void> {
  return withOwnShelf(
    request,
    label,
    { kind: "smart", match_mode: "any", rules },
    body,
  );
}

/**
 * Set the reader's scroll stops preference through the API. The switches
 * that write it belong to the specs for Settings and the book page; every
 * body below opens its book with a full load, so it reads the new value.
 */
async function setScrollStops(page: Page, on: boolean) {
  const resp = await page.request.post(
    "/api/account/book-detail-scroll-stops",
    {
      data: { enabled: on },
    },
  );
  expect(resp.status(), `setting scroll stops to ${on} failed`).toBe(200);
}

/**
 * Run `body` as a non-admin reader of their own on a cookie-less context, with
 * scroll stops set as asked. Every run sets the switch, so none needs resetting.
 */
async function asReader(
  { browser, request }: { browser: Browser; request: APIRequestContext },
  username: string,
  scrollStops: boolean,
  body: (page: Page) => Promise<void>,
) {
  await provisionUser(request, username, READER_PASSWORD);
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  try {
    await logInThroughUi(page, username, READER_PASSWORD);
    await setScrollStops(page, scrollStops);
    await body(page);
  } finally {
    await context.close();
  }
}

/** Set the suite admin's read status for `uuid` straight through the API. */
async function setReadStatus(
  request: APIRequestContext,
  uuid: string,
  status: "unread" | "reading" | "finished",
) {
  const resp = await request.put("/api/read-status", {
    data: { book_uuid: uuid, status },
  });
  expect(resp.status(), `PUT /api/read-status ${status} failed`).toBe(200);
}

/** The More stop's tile for the shelf holding the book. */
function shelfTile(page: Page, shelfId: number): Locator {
  return page.getByTestId(`bdmq-shelf-${shelfId}`);
}

/** The picker's checkbox tile for the hand-picked shelf called `name`. */
function pickerTile(picker: Locator, name: string): Locator {
  return picker.getByRole("checkbox", { name, exact: true });
}

/** The shelf's name wraps inside its tile: not spilling out, not cut short. */
async function expectNameFits(tile: Locator, name: string) {
  const label = tile.getByText(name, { exact: true });
  await expect
    .poll(() => label.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(0);
  // A line is ~17px; one pixel is the rounding of fractional line heights.
  await expect
    .poll(() => label.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeLessThanOrEqual(1);
}

/** Open the picker from the More stop and wait for it to list shelves. */
async function openPicker(page: Page) {
  await page.getByTestId("bdmq-add-to-shelf").click();
  const picker = page.getByTestId("shelf-picker");
  await expect(picker).toBeVisible();
  return picker;
}

test("renders the book detail shelves layout", async ({ page, request }) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await gotoReady(page, `/books/${uuid}`);

  await expectNavVisible(page);
  await expect(page.getByTestId("bdmq-more")).toBeAttached();
  await expect(page.getByTestId("bdmq-add-to-shelf")).toBeVisible();
});

test("renders Add to shelf beneath a series book's own shelf", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, SERIES_BOOK.title);
  await gotoReady(page, `/books/${uuid}`);

  await expect(page.getByTestId("bdmq-series-shelf")).toBeVisible();
  await expect(page.getByTestId("bdmq-add-to-shelf")).toBeVisible();
  // The series shelf already fills the stop, so a book on no shelf gets the
  // button alone rather than a big "Not on a shelf yet." under the covers.
  const more = page.getByTestId("bdmq-more");
  await expect(more).toContainText("On your shelves");
  await expect(more).not.toContainText("Not on a shelf yet.");
});

test("adds a book to a hand-picked shelf and takes it off again", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await withManualShelf(request, LONG_SHELF_LABEL, async ({ id, name }) => {
    await gotoReady(page, `/books/${uuid}`);
    const picker = await openPicker(page);
    await expect(
      picker.getByRole("heading", { name: "Add to shelf" }),
    ).toBeVisible();

    const tile = pickerTile(picker, name);
    const onPage = shelfTile(page, id);
    await expect(tile).not.toBeChecked();
    await expect(tile).toContainText("0 books");
    await expect(onPage).toHaveCount(0);
    await expectNameFits(tile, name);

    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/add-books",
        expectedBody: { id, book_uuids: [uuid] },
        expectedStatus: 200,
      },
      async () => tile.click(),
    );
    await expect(tile).toBeChecked();
    await expect(tile).toContainText("1 book");
    await expect(onPage).toHaveCount(1);
    await expect(onPage).toContainText("1 book");
    await expect(onPage).toContainText("Hand-picked");
    await expectNameFits(tile, name);

    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/remove-book",
        expectedBody: { id, book_uuid: uuid },
        expectedStatus: 200,
      },
      async () => tile.click(),
    );
    await expect(tile).not.toBeChecked();
    await expect(tile).toContainText("0 books");
    await expect(onPage).toHaveCount(0);
  });
});

test("shows a smart shelf holding the book as a tile and lists it as automatic", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  // Henri Poincare wrote no other fixture, so the rule matches this book only.
  const rules = [{ field: "author", op: "is", value: TARGET.authors[0]! }];
  await withSmartShelf(request, "E2E Rule Shelf", rules, async (shelf) => {
    await gotoReady(page, `/books/${uuid}`);

    const onPage = shelfTile(page, shelf.id);
    await expect(onPage).toContainText(shelf.name);
    await expect(onPage.locator(".shv-facet--kind")).toHaveText("Smart");
    await expect(page.getByTestId("bdmq-more")).not.toContainText(
      "Not on a shelf yet.",
    );

    const picker = await openPicker(page);
    await expect(picker.getByTestId("shelf-picker-hint")).toHaveText(
      "Only shelves you fill by hand are listed; smart shelves add books by their rules.",
    );
    const automatic = picker.getByTestId("shelf-picker-automatic");
    await expect(automatic).toContainText("Automatic");
    await expect(
      automatic.getByTestId(`shelf-picker-auto-${shelf.id}`),
    ).toContainText(shelf.name);
    // A rule fills it, so there is nothing to tick.
    await expect(pickerTile(picker, shelf.name)).toHaveCount(0);
  });
});

test("lists a smart shelf the moment marking the book finished makes it match", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  const finished = [{ field: "status", op: "is", value: "finished" }];
  await withSmartShelf(request, "E2E Rule Shelf", finished, async (shelf) => {
    // Read status is per-user and global, and this spec owns the book's.
    await setReadStatus(request, uuid, "unread");
    try {
      await gotoReady(page, `/books/${uuid}`);
      const onPage = shelfTile(page, shelf.id);
      await expect(page.getByTestId("bdmq-shelves-loading")).toHaveCount(0);
      await expect(onPage).toHaveCount(0);

      await expectMutation(
        page,
        {
          method: "POST",
          url: "/api/rpc/read-status/set",
          expectedStatus: 200,
        },
        async () => page.getByTestId("read-status-finished").click(),
      );

      // No reload: the page re-reads which shelves hold the book.
      await expect(onPage).toBeVisible();
      await expect(onPage).not.toContainText("0 books");
      await expect(page.getByTestId("bdmq-more")).not.toContainText(
        "Not on a shelf yet.",
      );
    } finally {
      await setReadStatus(request, uuid, "unread");
    }
  });
});

test("keeps the shelf unchanged when the add fails", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await withManualShelf(request, "E2E Book Shelf", async ({ id, name }) => {
    await gotoReady(page, `/books/${uuid}`);
    const picker = await openPicker(page);
    const tile = pickerTile(picker, name);

    await page.route("**/api/rpc/shelves/add-books", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      }),
    );
    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/add-books",
        expectedBody: { id, book_uuids: [uuid] },
        expectedStatus: 500,
      },
      async () => tile.click(),
    );
    await page.unroute("**/api/rpc/shelves/add-books");

    await expect(page.getByTestId("shelf-picker-error")).toContainText(name);
    await expect(picker).toBeVisible();
    await expect(tile).not.toBeChecked();
    await expect(shelfTile(page, id)).toHaveCount(0);

    // The failure belongs to that visit: a reopened picker starts clean.
    await page.getByTestId("shelf-picker-close").click();
    await expect(picker).toHaveCount(0);
    await openPicker(page);
    await expect(page.getByTestId("shelf-picker-error")).toHaveCount(0);
  });
});

test("keeps the shelf unchanged when the remove fails", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await withManualShelf(request, "E2E Book Shelf", async ({ id, name }) => {
    const filed = await request.post("/api/rpc/shelves/add-books", {
      data: { id, book_uuids: [uuid] },
    });
    expect(filed.status(), "filing the book on the shelf failed").toBe(200);

    await gotoReady(page, `/books/${uuid}`);
    const picker = await openPicker(page);
    const tile = pickerTile(picker, name);
    await expect(tile).toBeChecked();

    await page.route("**/api/rpc/shelves/remove-book", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      }),
    );
    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/remove-book",
        expectedBody: { id, book_uuid: uuid },
        expectedStatus: 500,
      },
      async () => tile.click(),
    );
    await page.unroute("**/api/rpc/shelves/remove-book");

    await expect(page.getByTestId("shelf-picker-error")).toContainText(name);
    await expect(tile).toBeChecked();
    await expect(shelfTile(page, id)).toBeVisible();
  });
});

test("dismisses the picker with Escape, its close button, or the backdrop", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await gotoReady(page, `/books/${uuid}`);
  const picker = await openPicker(page);

  // The overlay is `position: fixed`; an ancestor with a transform would pin
  // it inside the More stop instead of over the page.
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => (await picker.boundingBox())?.width)
    .toBe(viewport.width);

  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  await openPicker(page);
  await page.getByTestId("shelf-picker-close").click();
  await expect(picker).toHaveCount(0);

  // Bottom edge: the top strip is the sticky nav, which paints over the scrim.
  await openPicker(page);
  await picker.click({
    position: { x: viewport.width / 2, y: viewport.height - 4 },
  });
  await expect(picker).toHaveCount(0);
});

test("opens the picker over the whole window when the page snaps between stops", async ({
  browser,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await asReader({ browser, request }, SNAP_READER, true, async (page) => {
    await gotoReady(page, `/books/${uuid}`);
    // The mode is only known once the viewer resolves, so wait for the swap.
    await expect(page.locator("#bdmq-snap")).toBeAttached();
    await page.getByTestId("bdmq-dot-5").click();
    await expect(page.getByTestId("bdmq-dot-5")).toHaveClass(/\bon\b/);

    const picker = await openPicker(page);

    // A filter on the panel would make it the overlay's containing block and
    // pin the scrim to the panel's 57% rather than the window.
    const viewport = page.viewportSize()!;
    await expect
      .poll(async () => (await picker.boundingBox())?.width)
      .toBe(viewport.width);

    // The section label and next cue sit above the panel's stacking layer, so
    // they would paint over the scrim and take clicks meant for the backdrop.
    const label = page.getByTestId("bdmq-sec-5").locator(".bdmq-seclab");
    await expect(label).toHaveCSS("pointer-events", "none");
    await expect(label).toHaveCSS("opacity", "0");
    await expect(
      page.getByTestId("bdmq-sec-4").locator(".bdmq-next"),
    ).toHaveCSS("opacity", "0");
  });
});

test("hides the back-to-the-book pill while the picker is open", async ({
  browser,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await asReader({ browser, request }, FLOW_READER, false, async (page) => {
    await gotoReady(page, `/books/${uuid}`);
    await expect(page.locator("#bdmq-flow")).toBeAttached();
    await page.getByTestId("bdmq-dot-5").click();
    const backToBook = page.getByTestId("bdmq-flowtop");
    await expect(backToBook).toHaveClass(/\bon\b/);

    await openPicker(page);

    // The pill sits above the scrim, so it must not stay clickable through it.
    await expect(backToBook).toHaveCSS("pointer-events", "none");
    await expect(backToBook).toHaveCSS("opacity", "0");
  });
});

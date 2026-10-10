import type { APIRequestContext, Browser, Page } from "@playwright/test";

import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { expectNavVisible, gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";
import { withManualShelf } from "../utils/shelves";
import { logInThroughUi, provisionUser } from "../utils/users";

// The book page's More stop: "Add to shelf" opens a picker that files this
// book on a hand-picked shelf, or takes it off, without leaving the page.
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

const READER_PASSWORD = "shelf-reader-pw-00";
const SNAP_READER = "shelfsnap";

/** Set the reader's Use book details scroll stops switch through Settings. */
async function setScrollStops(page: Page, on: boolean) {
  await gotoReady(page, "/settings?section=account");
  const toggle = page.getByRole("switch", {
    name: "Use book details scroll stops",
  });
  await expect(toggle).toBeEnabled();
  if ((await toggle.isChecked()) === on) return;
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/account/book-detail-scroll-stops",
      expectedBody: { enabled: on },
      expectedStatus: 200,
    },
    async () => toggle.click(),
  );
  await expect(toggle).toBeChecked({ checked: on });
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
  await withManualShelf(request, "E2E Book Shelf", async ({ id, name }) => {
    await gotoReady(page, `/books/${uuid}`);
    const picker = await openPicker(page);
    await expect(
      picker.getByRole("heading", { name: "Add to shelf" }),
    ).toBeVisible();

    const row = picker.getByRole("checkbox", { name, exact: true });
    const chip = page.getByTestId("bdmq-shelves").filter({ hasText: name });
    await expect(row).not.toBeChecked();
    await expect(chip).toHaveCount(0);

    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/add-books",
        expectedBody: { id, book_uuids: [uuid] },
        expectedStatus: 200,
      },
      async () => row.click(),
    );
    await expect(row).toBeChecked();
    await expect(chip).toHaveCount(1);

    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/shelves/remove-book",
        expectedBody: { id, book_uuid: uuid },
        expectedStatus: 200,
      },
      async () => row.click(),
    );
    await expect(row).not.toBeChecked();
    await expect(chip).toHaveCount(0);
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
    const row = picker.getByRole("checkbox", { name, exact: true });

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
      async () => row.click(),
    );
    await page.unroute("**/api/rpc/shelves/add-books");

    await expect(page.getByTestId("shelf-picker-error")).toContainText(name);
    await expect(picker).toBeVisible();
    await expect(row).not.toBeChecked();
    await expect(
      page.getByTestId("bdmq-shelves").filter({ hasText: name }),
    ).toHaveCount(0);
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
  });
});

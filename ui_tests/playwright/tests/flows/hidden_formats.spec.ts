import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation, postFromPage } from "../utils/api";
import { expectNavVisible, gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Per-user hidden-formats preference: Settings → Preferences holds it, the
// landing All Books view excludes those formats, shows an "N hidden" receipt,
// and names the hidden formats in a note that links back to the preference.
// The suite runs fullyParallel against one shared server and every other spec
// shares the seeded admin's storageState — a real save on that admin would
// hide the two CBZ fixtures out from under `landing.spec.ts` in a parallel
// worker. So this spec provisions its OWN user (per-user pref = per-user
// blast radius) and drives a fresh, cookie-less context through the login UI.
// The CBZ fixtures (`aurora-station-01/-02`) are reserved for
// comic_reader.spec.ts's progress writes; the assertions here are read-only,
// which their reservation explicitly allows.
const PREFERENCES = "/settings?section=preferences";
const HIDDEN_USER = "hiddenformats";
// The Preferences tests save on their own user, so they never race the
// landing test over one account's preference.
const SAVE_USER = "hiddenformatssave";
const HIDDEN_PASSWORD = "hidden-formats-pw-00";
const HIDDEN_FORMATS_RPC = "/api/rpc/account/hidden-formats";

const receipt = (page: Page) => page.getByTestId("lib-hidden-count");
const formatToggle = (page: Page, format: string) =>
  page.getByTestId(`hidden-format-toggle-${format}`);
const saveStatus = (page: Page) => page.getByTestId("hidden-formats-status");
const hiddenNote = (page: Page) => page.getByTestId("lib-hidden-formats");
const auroraTiles = (page: Page) =>
  page.getByTestId(/^ebook-tile-aurora-station-/);

test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  await ensureUser(request, HIDDEN_USER);
  await ensureUser(request, SAVE_USER);
});

/** Provision a dedicated user via the admin API; 409 = already there. */
async function ensureUser(
  request: APIRequestContext,
  username: string,
): Promise<void> {
  const resp = await request.post("/api/admin/users", {
    data: {
      username,
      password: HIDDEN_PASSWORD,
      permissions: {
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: true,
      },
    },
  });
  expect([201, 409]).toContain(resp.status());
}

/** Log a dedicated user in through the login UI on a cookie-less page. */
async function logInAs(page: Page, username: string): Promise<void> {
  await gotoReady(page, "/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(HIDDEN_PASSWORD);
  await expectMutation(
    page,
    { method: "POST", url: "/api/auth/login", expectedStatus: 200 },
    async () => page.getByRole("button", { name: "Log in" }).click(),
  );
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Save the user's hidden formats straight through the API, to set up what the
 * library test reads; the Preferences tests below drive the card itself.
 */
async function saveHiddenFormats(page: Page, formats: string[]): Promise<void> {
  const status = await postFromPage(page, HIDDEN_FORMATS_RPC, { formats });
  expect(status, `saving hidden formats ${formats} failed`).toBe(200);
}

test("renders the hidden-formats card in the preferences section", async ({
  page,
}) => {
  await gotoReady(page, PREFERENCES);

  await expect(page.getByTestId("account-hidden-formats-card")).toBeVisible();
  await expect(page.getByTestId("hidden-format-toggle-cbz")).toBeVisible();
  await expect(page.getByTestId("hidden-format-toggle-epub")).toBeVisible();
  await expectNavVisible(page);
});

test("hiding cbz removes comics from the landing for that user only", async ({
  browser,
  page: adminPage,
}) => {
  // Fresh cookie-less context: the pref must never touch the shared admin.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  try {
    await logInAs(page, HIDDEN_USER);
    await saveHiddenFormats(page, ["cbz"]);

    // Landing: both CBZ-only fixtures gone, receipt visible, and the note
    // naming what is hidden. No exact count — other specs may be reshaping
    // the shared library in parallel.
    await gotoReady(page, "/");
    await expect(auroraTiles(page)).toHaveCount(0);
    await expect(receipt(page)).toBeVisible();
    await expect(receipt(page)).toHaveText(/· \d+ hidden/);
    await expect(hiddenNote(page)).toContainText("Hidden: CBZ");

    // Scope check: the exclusion is landing-only — search still finds the
    // hidden comic.
    await page.getByTestId("search-trigger").click();
    await page.getByTestId("sp-input").fill("Aurora Station");
    await expect
      .poll(async () => page.getByTestId("sp-book-row").count())
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");

    // The note leads to the preference that hides them.
    await hiddenNote(page).click();
    await expect(page).toHaveURL(/\/settings\?section=preferences$/);
    await expect(page.getByTestId("account-hidden-formats-card")).toBeVisible();

    // Per-user isolation: the seeded admin (shared storageState) still sees
    // the comics, no receipt and no note.
    await gotoReady(adminPage, "/");
    await expect(auroraTiles(adminPage).first()).toBeVisible();
    await expect(receipt(adminPage)).toHaveCount(0);
    await expect(hiddenNote(adminPage)).toHaveCount(0);

    // Un-hide: tiles return, receipt and note gone.
    await saveHiddenFormats(page, []);
    await gotoReady(page, "/");
    await expect(auroraTiles(page).first()).toBeVisible();
    await expect(receipt(page)).toHaveCount(0);
    await expect(hiddenNote(page)).toHaveCount(0);
  } finally {
    // Always clear the pref — a retry or later run must start unhidden. Not
    // a hard assert (that would mask whichever failure got us here), but a
    // failed cleanup is loud so leaked state never reads as a mystery flake.
    try {
      const status = await postFromPage(page, HIDDEN_FORMATS_RPC, {
        formats: [],
      });
      if (status !== 200) {
        console.warn(
          `hidden_formats cleanup POST failed (${status}) — later runs may start with cbz hidden`,
        );
      }
    } catch (e) {
      console.warn(`hidden_formats cleanup POST threw: ${e}`);
    }
    await context.close();
  }
});

test.describe("the preference saves as it changes", () => {
  // The tests share one signed-in page (sign-in is rate limited) and reset the
  // same account's preference, so they run in order.
  test.describe.configure({ mode: "serial" });
  let context: BrowserContext;
  let page: Page;

  test.beforeAll("sign in as the save user", async ({ browser }) => {
    context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    page = await context.newPage();
    await logInAs(page, SAVE_USER);
  });

  test.afterAll("clear the preference", async () => {
    await postFromPage(page, HIDDEN_FORMATS_RPC, { formats: [] });
    await context.close();
  });

  /** Open Preferences with `hidden` already saved. */
  async function openPreferences(hidden: string[] = []): Promise<void> {
    expect(
      await postFromPage(page, HIDDEN_FORMATS_RPC, { formats: hidden }),
    ).toBe(200);
    await gotoReady(page, PREFERENCES);
  }

  test("hide and show a format by ticking it", async () => {
    await openPreferences();

    await expectMutation(
      page,
      {
        method: "POST",
        url: HIDDEN_FORMATS_RPC,
        expectedBody: { formats: ["cbz"] },
        expectedStatus: 200,
      },
      async () => formatToggle(page, "cbz").check(),
    );
    await expect(saveStatus(page)).toHaveText("Saved");

    await expectMutation(
      page,
      {
        method: "POST",
        url: HIDDEN_FORMATS_RPC,
        expectedBody: { formats: [] },
        expectedStatus: 200,
      },
      async () => formatToggle(page, "cbz").uncheck(),
    );
    await expect(saveStatus(page)).toHaveText("Saved");
  });

  test("show a saved format the library doesn't list", async () => {
    await openPreferences(["djvu"]);
    await expect(formatToggle(page, "djvu")).toBeChecked();

    await expectMutation(
      page,
      {
        method: "POST",
        url: HIDDEN_FORMATS_RPC,
        expectedBody: { formats: [] },
        expectedStatus: 200,
      },
      // A plain click: the box leaves the list once unhidden, so uncheck()
      // would wait on a state it can no longer read.
      async () => formatToggle(page, "djvu").click(),
    );

    await expect(saveStatus(page)).toHaveText("Saved");
    await expect(formatToggle(page, "djvu")).toHaveCount(0);
  });

  test("put a format back when the server refuses the save", async () => {
    await openPreferences();
    await page.route(`**${HIDDEN_FORMATS_RPC}`, (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    try {
      await expectMutation(
        page,
        { method: "POST", url: HIDDEN_FORMATS_RPC, expectedStatus: 500 },
        async () => formatToggle(page, "cbz").click(),
      );

      await expect(saveStatus(page)).toHaveText(/Couldn.t save/);
      await expect(formatToggle(page, "cbz")).not.toBeChecked();
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }
  });
});

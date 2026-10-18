import type { APIRequestContext, Page } from "@playwright/test";
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
const HIDDEN_PASSWORD = "hidden-formats-pw-00";
const HIDDEN_FORMATS_RPC = "/api/rpc/account/hidden-formats";

const receipt = (page: Page) => page.getByTestId("lib-hidden-count");
const hiddenNote = (page: Page) => page.getByTestId("lib-hidden-formats");
const auroraTiles = (page: Page) =>
  page.getByTestId(/^ebook-tile-aurora-station-/);

test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  await ensureHiddenUser(request);
});

/** Provision the dedicated user via the admin API; 409 = already there. */
async function ensureHiddenUser(request: APIRequestContext): Promise<void> {
  const resp = await request.post("/api/admin/users", {
    data: {
      username: HIDDEN_USER,
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

/** Log the dedicated user in through the login UI on a cookie-less page. */
async function logInAsHiddenUser(page: Page): Promise<void> {
  await gotoReady(page, "/login");
  await page.getByLabel("Username").fill(HIDDEN_USER);
  await page.getByLabel("Password").fill(HIDDEN_PASSWORD);
  await expectMutation(
    page,
    { method: "POST", url: "/api/auth/login", expectedStatus: 200 },
    async () => page.getByRole("button", { name: "Log in" }).click(),
  );
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Save the user's hidden formats straight through the API. The Preferences
 * card that writes them is account.spec.ts's to drive; this spec is about
 * what the library does with the preference.
 */
async function saveHiddenFormats(
  page: Page,
  formats: string[],
): Promise<void> {
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
    await logInAsHiddenUser(page);
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
      const resp = await context.request.post(HIDDEN_FORMATS_RPC, {
        data: { formats: [] },
      });
      if (!resp.ok()) {
        console.warn(
          `hidden_formats cleanup POST failed (${resp.status()}) — later runs may start with cbz hidden`,
        );
      }
    } catch (e) {
      console.warn(`hidden_formats cleanup POST threw: ${e}`);
    }
    await context.close();
  }
});

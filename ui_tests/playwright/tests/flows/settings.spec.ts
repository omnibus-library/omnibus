import type { Page } from "@playwright/test";
import { test as readerTest } from "../fixtures/readerFixtures";
import { expect, test } from "../fixtures/test";
import { expectMutation, recordRequests } from "../utils/api";
import { expectNavVisible, gotoReady } from "../utils/nav";

// Settings splits in two shells. `/settings` holds each reader's own sections
// and `/admin` the server's, each section behind a `?section=` slug, so tests
// navigate straight to the section whose controls they exercise. The seeded
// dev user is an admin, so every admin section is present.
const ADMIN_SOURCES = "/admin?section=sources";
const ADMIN_INTEGRATIONS = "/admin?section=integrations";
const ADMIN_MAINTENANCE = "/admin?section=maintenance";

const ebookInput = (page: Page) => page.getByLabel("Ebook library path");
const audiobookInput = (page: Page) =>
  page.getByLabel("Audiobook library path");
const scanIntervalInput = (page: Page) =>
  page.getByLabel("Automatic rescan interval (hours)");
const saveButton = (page: Page) =>
  page.getByRole("button", { name: "Save library settings" });
const settingsStatus = (page: Page) => page.getByTestId("settings-status");
// The maintenance commands report on their own line, apart from the form's.
const maintenanceStatus = (page: Page) =>
  page.getByTestId("maintenance-status");
// The key cards share Integrations with SMTP, so their controls are
// testid-scoped rather than named "Save"/"Clear…".
const hardcoverKeyInput = (page: Page) => page.getByLabel("Hardcover API key");
const hardcoverSaveButton = (page: Page) => page.getByTestId("hardcover-save");
const hardcoverClearButton = (page: Page) =>
  page.getByTestId("hardcover-clear");
const hardcoverClearConfirm = (page: Page) =>
  page.getByTestId("hardcover-clear-dialog-confirm");
const hardcoverStatus = (page: Page) => page.getByTestId("hardcover-status");
const hardcoverMessage = (page: Page) =>
  page.getByTestId("hardcover-key-status");
const googleBooksKeyInput = (page: Page) =>
  page.getByLabel("Google Books API key");
const googleBooksSaveButton = (page: Page) =>
  page.getByTestId("google-books-save");
const googleBooksClearButton = (page: Page) =>
  page.getByTestId("google-books-clear");
const googleBooksClearConfirm = (page: Page) =>
  page.getByTestId("google-books-clear-dialog-confirm");
const googleBooksStatus = (page: Page) =>
  page.getByTestId("google-books-status");
const googleBooksMessage = (page: Page) =>
  page.getByTestId("google-books-key-status");

test("renders the settings sidebar with the personal sections", async ({
  page,
}) => {
  await gotoReady(page, "/settings");

  await expect(page.getByTestId("settings-layout")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
  for (const slug of [
    "profile",
    "preferences",
    "goals",
    "devices",
    "security",
  ]) {
    await expect(page.getByTestId(`settings-nav-${slug}`)).toBeVisible();
  }
  // An admin also gets the way into Administration.
  await expect(page.getByTestId("settings-nav-admin")).toBeVisible();
  await expectNavVisible(page);
});

test("renders the administration sidebar with every admin section", async ({
  page,
}) => {
  await gotoReady(page, "/admin");

  await expect(page.getByTestId("admin-layout")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Administration" }),
  ).toBeVisible();
  for (const slug of [
    "sources",
    "maintenance",
    "metadata",
    "cleanup",
    "people",
    "integrations",
    "health",
    "logs",
  ]) {
    await expect(page.getByTestId(`admin-nav-${slug}`)).toBeVisible();
  }
  await expect(page.getByTestId("admin-nav-sources")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("admin-nav-settings")).toBeVisible();
  await expectNavVisible(page);
});

readerTest(
  "refuses administration to a reader who is not an admin",
  async ({ page }) => {
    await gotoReady(page, "/admin?section=people");

    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await expect(page.getByTestId("users-card")).toHaveCount(0);
  },
);

test("renders the Sources section controls", async ({ page }) => {
  await gotoReady(page, ADMIN_SOURCES);

  await expect(page.getByTestId("admin-nav-sources")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(ebookInput(page)).toBeVisible();
  await expect(audiobookInput(page)).toBeVisible();
  await expect(scanIntervalInput(page)).toBeVisible();
  await expect(saveButton(page)).toBeEnabled();
  // The maintenance commands are their own section, not part of this form.
  await expect(page.getByTestId("scan-library")).toHaveCount(0);
  await expect(settingsStatus(page)).toBeAttached();
  await expect(page.getByTestId("ebook-library-summary")).toBeAttached();
  await expect(page.getByTestId("audiobook-library-summary")).toBeAttached();
});

test("holds the library save after the saved settings fail to load", async ({
  page,
}) => {
  await page.route("**/api/rpc/settings", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      });
    }
    return route.continue();
  });

  await gotoReady(page, ADMIN_SOURCES);

  // Blank fields saved over a failed read would clear both library paths.
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByTestId("library-retry")).toBeVisible();
  await expect(settingsStatus(page)).toHaveClass(/error/);
});

test("navigates between admin sections from the sidebar and updates the URL", async ({
  page,
}) => {
  await gotoReady(page, "/admin");

  await page.getByTestId("admin-nav-integrations").click();
  await expect(page).toHaveURL(/\/admin\?section=integrations$/);
  await expect(page.getByTestId("smtp-card")).toBeVisible();
  await expect(page.getByTestId("hardcover-key-card")).toBeVisible();
  await expect(page.getByTestId("google-books-key-card")).toBeVisible();

  await page.getByTestId("admin-nav-people").click();
  await expect(page).toHaveURL(/\/admin\?section=people$/);
  await expect(page.getByTestId("users-card")).toBeVisible();

  await page.getByTestId("admin-nav-health").click();
  await expect(page).toHaveURL(/\/admin\?section=health$/);
  await expect(page.getByTestId("admin-health-page")).toBeVisible();

  await page.getByTestId("admin-nav-maintenance").click();
  await expect(page).toHaveURL(/\/admin\?section=maintenance$/);
  await expect(page.getByTestId("maintenance-card")).toBeVisible();
  await expect(page.getByTestId("background-tasks-card")).toBeVisible();

  await page.getByTestId("admin-nav-logs").click();
  await expect(page).toHaveURL(/\/admin\?section=logs$/);
  await expect(page.getByTestId("logs-page")).toBeVisible();
});

test("saves the SMTP config and shows a configured status", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);

  await page.getByLabel("SMTP host").fill("smtp.example.com");
  await page.getByLabel("From address").fill("library@example.com");
  await page.getByLabel("Password").fill("s3cret-pass");

  // Mock the save so the test never depends on a real SMTP relay and never
  // mutates shared server state; the UI renders from the returned masked
  // status. The raw password must never come back — only `password_masked`.
  await page.route("**/api/rpc/smtp", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          host: "smtp.example.com",
          port: 587,
          username: null,
          from_email: "library@example.com",
          security: "starttls",
          password_masked: "s3…ss",
          source: "settings",
        }),
      });
    }
    return route.continue();
  });

  await expectMutation(
    page,
    { method: "POST", url: "/api/rpc/smtp", expectedStatus: 200 },
    async () => page.getByTestId("smtp-save").click(),
  );

  await expect(page.getByTestId("smtp-config-status")).toHaveText(
    "SMTP settings saved.",
  );
  await expect(page.getByTestId("smtp-status")).toContainText("Configured");
});

test("asks before clearing the SMTP settings", async ({ page }) => {
  // Configured is instance state, so the read is stubbed rather than set.
  await page.route("**/api/rpc/smtp", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            configured: true,
            host: "smtp.example.com",
            port: 587,
            username: null,
            from_email: "library@example.com",
            security: "starttls",
            password_masked: "s3…ss",
            source: "settings",
          },
        })
      : route.continue(),
  );
  await gotoReady(page, ADMIN_INTEGRATIONS);
  const clears = recordRequests(page, "/api/rpc/smtp/clear");

  await page.getByTestId("smtp-clear").click();
  await expect(page.getByTestId("smtp-clear-dialog")).toBeVisible();
  await page.getByTestId("smtp-clear-dialog-cancel").click();

  await expect(page.getByTestId("smtp-clear-dialog")).toHaveCount(0);
  expect(clears).toEqual([]);
});

test("asks before leaving unsaved library paths", async ({ page }) => {
  await gotoReady(page, ADMIN_SOURCES);
  await expect(saveButton(page)).toBeEnabled();
  await ebookInput(page).fill("/srv/unsaved-path");

  await page.getByTestId("admin-nav-people").click();
  await expect(page.getByTestId("unsaved-confirm")).toBeVisible();
  await page.getByTestId("unsaved-keep").click();

  await expect(page).toHaveURL(/section=sources$/);
  await expect(ebookInput(page)).toHaveValue("/srv/unsaved-path");
});

test("asks before leaving a typed but unsaved key", async ({ page }) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);
  await hardcoverKeyInput(page).fill("hc_unsaved");

  await page.getByTestId("admin-nav-people").click();
  await expect(page.getByTestId("unsaved-confirm")).toBeVisible();
  await page.getByTestId("unsaved-discard").click();

  await expect(page).toHaveURL(/section=people$/);
});

test("saves only the metadata order that changed", async ({ page }) => {
  // The order is instance configuration other specs index under, so the
  // write is answered here with the order it was sent.
  await page.route("**/api/rpc/metadata-precedence/set", (route) =>
    route.fulfill({ json: route.request().postDataJSON().precedence }),
  );
  await gotoReady(page, "/admin?section=metadata");
  const save = page.getByTestId("metadata-precedence-save");
  await expect(
    page.getByTestId("ebook-metadata-precedence-item-0"),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  const writes = recordRequests(page, "/api/rpc/metadata-precedence/set");

  await page.getByTestId("ebook-metadata-precedence-down-0").click();
  await expect(save).toBeEnabled();
  const { request } = await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/metadata-precedence/set",
      expectedStatus: 200,
    },
    async () => save.click(),
  );

  expect(request.postDataJSON().library).toBe("ebook");
  await expect(page.getByTestId("metadata-precedence-status")).toHaveText(
    "Metadata order saved.",
  );
  await expect(save).toBeDisabled();
  expect(writes).toHaveLength(1);
});

test("follows an old settings link to its new home", async ({ page }) => {
  await gotoReady(page, "/settings?section=users");
  await expect(page).toHaveURL(/\/admin\?section=people$/);

  await gotoReady(page, "/settings/cleanup/authors");
  await expect(page).toHaveURL(/\/admin\/cleanup\/authors$/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Whether the page scrolls sideways. */
  const scrollsSideways = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );

  test("pick a settings section from the list, then go back", async ({
    page,
  }) => {
    await gotoReady(page, "/settings");
    await expect(page.getByTestId("settings-nav-devices")).toBeVisible();
    await expect(page.getByTestId("settings-back")).toBeHidden();
    expect(await scrollsSideways(page)).toBe(false);

    await page.getByTestId("settings-nav-devices").click();
    await expect(page).toHaveURL(/\/settings\?section=devices$/);
    await expect(page.getByTestId("account-kindle-card")).toBeVisible();
    await expect(page.getByTestId("settings-nav-devices")).toBeHidden();
    expect(await scrollsSideways(page)).toBe(false);

    await page.getByTestId("settings-back").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-nav-devices")).toBeVisible();
  });

  test("pick an administration section from the list", async ({ page }) => {
    await gotoReady(page, "/admin");
    await page.getByTestId("admin-nav-people").click();

    await expect(page).toHaveURL(/\/admin\?section=people$/);
    await expect(page.getByTestId("users-table")).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });
});

test("saves library paths and shows a success status", async ({ page }) => {
  await gotoReady(page, ADMIN_SOURCES);

  const ebookPath = "/tmp/omnibus-test-ebooks";
  const audiobookPath = "/tmp/omnibus-test-audiobooks";

  await ebookInput(page).fill(ebookPath);
  await audiobookInput(page).fill(audiobookPath);

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/settings",
      expectedBody: {
        settings: {
          ebook_library_path: ebookPath,
          audiobook_library_path: audiobookPath,
        },
      },
      expectedStatus: 200,
    },
    async () => saveButton(page).click(),
  );

  await expect(settingsStatus(page)).toHaveText("Library settings saved.");
  await expect(settingsStatus(page)).toHaveClass(/success/);
});

test("saves an automatic rescan interval alongside the library paths", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_SOURCES);

  const ebookPath = "/tmp/omnibus-test-ebooks";
  const audiobookPath = "/tmp/omnibus-test-audiobooks";

  await ebookInput(page).fill(ebookPath);
  await audiobookInput(page).fill(audiobookPath);
  await scanIntervalInput(page).fill("24");

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/settings",
      expectedBody: {
        settings: {
          ebook_library_path: ebookPath,
          audiobook_library_path: audiobookPath,
          scan_interval_hours: 24,
        },
      },
      expectedStatus: 200,
    },
    async () => saveButton(page).click(),
  );

  await expect(settingsStatus(page)).toHaveText("Library settings saved.");
  await expect(settingsStatus(page)).toHaveClass(/success/);
});

test("shows an error status when the server rejects an invalid rescan interval", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_SOURCES);

  // Fill every field explicitly (rather than relying on whatever an
  // earlier test left saved) so the expected request body below is
  // deterministic regardless of test order.
  await ebookInput(page).fill("/tmp/whatever");
  await audiobookInput(page).fill("/tmp/whatever-audio");
  await scanIntervalInput(page).fill("1");

  // Force the validation failure server-side (e.g. a stale client vs. a
  // future, stricter floor) rather than relying on the browser's own
  // `min` enforcement, so this exercises the same error-status rendering
  // path as any other 4xx/5xx save failure.
  await page.route("**/api/rpc/settings", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 422,
        contentType: "text/plain",
        body: "scan_interval_hours must be at least 1 (omit to disable)",
      });
    }
    return route.continue();
  });

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/settings",
      expectedBody: {
        settings: {
          ebook_library_path: "/tmp/whatever",
          audiobook_library_path: "/tmp/whatever-audio",
          scan_interval_hours: 1,
        },
      },
      expectedStatus: 422,
    },
    async () => saveButton(page).click(),
  );

  await expect(settingsStatus(page)).toContainText(
    "Couldn’t save the library settings",
  );
  await expect(settingsStatus(page)).toHaveClass(/error/);
});

test("shows an error status when saving settings fails", async ({ page }) => {
  await gotoReady(page, ADMIN_SOURCES);

  await ebookInput(page).fill("/tmp/whatever");
  await audiobookInput(page).fill("/tmp/whatever-audio");
  // Cleared explicitly (rather than left at whatever an earlier test
  // saved) so the expected request body below omits `scan_interval_hours`
  // deterministically, regardless of test order.
  await scanIntervalInput(page).fill("");

  await page.route("**/api/rpc/settings", (route) => {
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
      url: "/api/rpc/settings",
      expectedBody: {
        settings: {
          ebook_library_path: "/tmp/whatever",
          audiobook_library_path: "/tmp/whatever-audio",
        },
      },
      expectedStatus: 500,
    },
    async () => saveButton(page).click(),
  );

  await expect(settingsStatus(page)).toContainText(
    "Couldn’t save the library settings",
  );
  await expect(settingsStatus(page)).toHaveClass(/error/);
});

test("shows an error status when a manual library scan fails", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_MAINTENANCE);

  await page.route("**/api/rpc/scan-library", (route) => {
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
    { method: "POST", url: "/api/rpc/scan-library", expectedStatus: 500 },
    async () => page.getByTestId("scan-library").click(),
  );

  await expect(maintenanceStatus(page)).toContainText(
    "Failed to start library scan",
  );
  await expect(maintenanceStatus(page)).toHaveClass(/error/);
});

test("bakes overrides into every EPUB and shows a queued status", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_MAINTENANCE);

  await page.route("**/api/rpc/admin/rewrite-all-epubs", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    }
    return route.continue();
  });

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/admin/rewrite-all-epubs",
      expectedStatus: 200,
    },
    async () => page.getByTestId("rewrite-all-epubs").click(),
  );

  await expect(maintenanceStatus(page)).toHaveText(
    "EPUB override bake queued.",
  );
  await expect(maintenanceStatus(page)).not.toHaveClass(/error/);
});

test("shows an error status when the bulk EPUB rewrite fails to queue", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_MAINTENANCE);

  await page.route("**/api/rpc/admin/rewrite-all-epubs", (route) => {
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
      url: "/api/rpc/admin/rewrite-all-epubs",
      expectedStatus: 500,
    },
    async () => page.getByTestId("rewrite-all-epubs").click(),
  );

  await expect(maintenanceStatus(page)).toContainText(
    "Failed to start EPUB override bake",
  );
  await expect(maintenanceStatus(page)).toHaveClass(/error/);
});

// ---------------------------------------------------------------------------
// Action — Hardcover and Google Books key save/clear
// ---------------------------------------------------------------------------

test("saves a Hardcover key, shows a connected status, then clears it", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);

  const key = `hc_test_${Date.now()}`;

  await hardcoverKeyInput(page).fill(key);
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/hardcover-key",
      expectedBody: { key },
      expectedStatus: 200,
    },
    async () => hardcoverSaveButton(page).click(),
  );

  await expect(hardcoverMessage(page)).toHaveText("Hardcover key saved.");
  await expect(hardcoverMessage(page)).toHaveClass(/success/);
  await expect(hardcoverStatus(page)).toContainText("Connected");
  // The raw key is never echoed back to the client.
  await expect(hardcoverKeyInput(page)).toHaveValue("");
  await expect(hardcoverClearButton(page)).toBeVisible();

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/hardcover-key",
      expectedBody: { key: null },
      expectedStatus: 200,
    },
    async () => {
      // Clearing asks first, since the key can't be read back to restore it.
      await hardcoverClearButton(page).click();
      await hardcoverClearConfirm(page).click();
    },
  );

  await expect(hardcoverMessage(page)).toHaveText("Hardcover key cleared.");
  await expect(hardcoverMessage(page)).toHaveClass(/success/);
  await expect(hardcoverStatus(page)).toContainText("Not connected");
  await expect(hardcoverClearButton(page)).toHaveCount(0);
});

test("shows an error status when saving the Hardcover key fails", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);

  // Only fail the write — the mount-time GET status fetch must still pass
  // through, otherwise the card never renders the fields under test.
  await page.route("**/api/rpc/hardcover-key", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      });
    }
    return route.continue();
  });

  const key = `hc_test_error_${Date.now()}`;
  await hardcoverKeyInput(page).fill(key);

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/hardcover-key",
      expectedBody: { key },
      expectedStatus: 500,
    },
    async () => hardcoverSaveButton(page).click(),
  );

  await expect(hardcoverMessage(page)).toContainText(
    "Couldn’t save the Hardcover key",
  );
  await expect(hardcoverMessage(page)).toHaveClass(/error/);
  // The failed save must not clear the admin's typed-in draft.
  await expect(hardcoverKeyInput(page)).toHaveValue(key);
});

test("saves a Google Books key, shows a connected status, then clears it", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);

  const key = `AIza_test_${Date.now()}`;

  await googleBooksKeyInput(page).fill(key);
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/google-books-key",
      expectedBody: { key },
      expectedStatus: 200,
    },
    async () => googleBooksSaveButton(page).click(),
  );

  await expect(googleBooksMessage(page)).toHaveText("Google Books key saved.");
  await expect(googleBooksMessage(page)).toHaveClass(/success/);
  await expect(googleBooksStatus(page)).toContainText("Connected");
  // The raw key is never echoed back to the client.
  await expect(googleBooksKeyInput(page)).toHaveValue("");
  await expect(googleBooksClearButton(page)).toBeVisible();

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/google-books-key",
      expectedBody: { key: null },
      expectedStatus: 200,
    },
    async () => {
      await googleBooksClearButton(page).click();
      await googleBooksClearConfirm(page).click();
    },
  );

  await expect(googleBooksMessage(page)).toHaveText(
    "Google Books key cleared.",
  );
  await expect(googleBooksMessage(page)).toHaveClass(/success/);
  await expect(googleBooksStatus(page)).toContainText("Not connected");
  await expect(googleBooksClearButton(page)).toHaveCount(0);
});

test("shows an error status when saving the Google Books key fails", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);

  // Only fail the write — the mount-time GET status fetch must still pass
  // through, otherwise the card never renders the fields under test.
  await page.route("**/api/rpc/google-books-key", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced failure",
      });
    }
    return route.continue();
  });

  const key = `AIza_test_error_${Date.now()}`;
  await googleBooksKeyInput(page).fill(key);

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/google-books-key",
      expectedBody: { key },
      expectedStatus: 500,
    },
    async () => googleBooksSaveButton(page).click(),
  );

  await expect(googleBooksMessage(page)).toContainText(
    "Couldn’t save the Google Books key",
  );
  await expect(googleBooksMessage(page)).toHaveClass(/error/);
  // The failed save must not clear the admin's typed-in draft.
  await expect(googleBooksKeyInput(page)).toHaveValue(key);
});

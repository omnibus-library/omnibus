import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
import { expectMutation, postFromPage, recordRequests } from "../utils/api";
import { TEST_PASSWORD } from "../utils/auth";
import { expectNavVisible, gotoReady } from "../utils/nav";

// Personal settings (#2763) are five sections: Profile (display name and
// picture), Preferences (theme, Stack series, hidden formats, scroll stops
// and share stats, each saving as it changes), Goals, Devices (Kindle
// delivery and Kobo wireless sync) and Sign-in & security (password,
// sessions, API tokens). The legacy standalone `/account` page redirects
// into Settings. The seeded session (global setup) is an authed admin, which
// is a superset of the plain-user access these sections need. The admin's
// Stack series, hidden formats and scroll stops are read by other specs, so
// this file only asserts those controls render; it never flips them.
const PROFILE = "/settings?section=profile";
const PREFERENCES = "/settings?section=preferences";
const GOALS = "/settings?section=goals";
const DEVICES = "/settings?section=devices";
const SECURITY = "/settings?section=security";

const emailInput = (page: Page) => page.getByTestId("kindle-email-input");
const currentPassword = (page: Page) =>
  page.getByTestId("current-password-input");
const newPassword = (page: Page) => page.getByTestId("new-password-input");
const changeStatus = (page: Page) => page.getByTestId("change-password-status");
const displayNameInput = (page: Page) => page.getByTestId("display-name-input");
const profileStatus = (page: Page) => page.getByTestId("profile-status");
const saveDisplayName = (page: Page) => page.getByTestId("display-name-save");

/** Answer the Kobo device list read with `devices`. */
async function stubKoboDevices(
  page: Page,
  devices: { id: number; name: string }[],
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/rpc/kobo/devices",
    (route) =>
      route.fulfill({
        status: 200,
        json: devices.map((d) => ({
          ...d,
          token: `tok-${d.id}`,
          created_at: 0,
          last_seen_at: 0,
        })),
      }),
  );
}

/** Answer the Kindle delivery read with `body`. */
async function stubKindleDelivery(
  page: Page,
  body: { sender_address: string | null },
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/rpc/kindle/delivery",
    (route) => route.fulfill({ status: 200, json: body }),
  );
}

test("renders the profile section layout", async ({ page }) => {
  await gotoReady(page, PROFILE);

  await expect(page.getByTestId("settings-nav-profile")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("account-profile-card")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Profile" }),
  ).toBeVisible();
  await expect(displayNameInput(page)).toBeVisible();
  // Nothing to save until the name changes.
  await expect(saveDisplayName(page)).toBeDisabled();
  // The picker's file input is visually hidden but still in the tab order.
  await page.getByTestId("avatar-file-input").focus();
  await expect(page.getByTestId("avatar-file-input")).toBeFocused();
  // Password lives under Sign-in & security now.
  await expect(page.getByTestId("account-password-card")).toHaveCount(0);

  await expectNavVisible(page);
});

test("renders the preferences section layout", async ({ page }) => {
  await gotoReady(page, PREFERENCES);

  await expect(page.getByTestId("settings-nav-preferences")).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const group of ["Appearance", "Library", "Book page", "Privacy"]) {
    await expect(
      page.getByRole("heading", { level: 3, name: group }),
    ).toBeVisible();
  }
  await expect(page.getByText("Applies to this device.")).toBeVisible();
  await expect(page.getByTestId("theme-dark")).toBeVisible();
  for (const name of [
    "Stack series",
    "Scroll stops",
    "Share stats with household",
  ]) {
    await expect(page.getByRole("switch", { name })).toBeEnabled();
  }
  // Hidden formats is one labelled group of checkboxes that saves on change
  // (its behaviour is covered by hidden_formats.spec.ts).
  await expect(
    page.getByRole("group", { name: "Hidden formats" }),
  ).toBeVisible();
  await expect(page.getByTestId("hidden-format-toggle-epub")).toBeVisible();
  await expect(page.getByTestId("hidden-formats-save")).toHaveCount(0);

  await expectNavVisible(page);
});

test("renders the devices section layout", async ({ page }) => {
  await gotoReady(page, DEVICES);

  await expect(page.getByTestId("settings-nav-devices")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { level: 3, name: "Kindle" }),
  ).toBeVisible();
  await expect(page.getByTestId("account-kindle-card")).toBeVisible();
  await expect(emailInput(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save Kindle email" }),
  ).toBeVisible();
  await expect(page.getByTestId("kindle-email-connected")).toBeAttached();
  await expect(page.getByTestId("kindle-delivery")).toBeVisible();
  await expect(page.getByTestId("kobo-devices-card")).toBeVisible();
  await expect(page.getByTestId("kobo-data-loss-warning")).toBeVisible();
  await expect(page.getByText("How to connect a Kobo")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Choose shelves to sync" }),
  ).toHaveAttribute("href", "/shelves");

  await expectNavVisible(page);
});

test("renders the sign-in and security section layout", async ({ page }) => {
  await gotoReady(page, SECURITY);

  await expect(page.getByTestId("settings-nav-security")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { level: 3, name: "Password" }),
  ).toBeVisible();
  await expect(page.getByTestId("account-password-card")).toBeVisible();
  await expect(currentPassword(page)).toBeVisible();
  await expect(newPassword(page)).toBeVisible();
  await expect(page.getByTestId("change-password-submit")).toBeVisible();
  await expect(page.getByTestId("account-sessions-card")).toBeVisible();
  await expect(page.getByTestId("api-tokens-card")).toBeVisible();

  await expectNavVisible(page);
});

// Delivery readiness is instance configuration (an SMTP relay), so the two
// states are stubbed rather than set up on the shared server.
test("names the sender to approve when Kindle delivery is ready", async ({
  page,
}) => {
  await stubKindleDelivery(page, {
    sender_address: "library@example.com",
  });
  await gotoReady(page, DEVICES);

  await expect(page.getByTestId("kindle-delivery")).toContainText(
    "Approve library@example.com",
  );
  await expect(page.getByTestId("kindle-sender-copy")).toBeVisible();
});

test("links an admin to integrations when Kindle delivery isn't set up", async ({
  page,
}) => {
  await stubKindleDelivery(page, {
    sender_address: null,
  });
  await gotoReady(page, DEVICES);

  await expect(
    page.getByRole("link", { name: "Set up email delivery" }),
  ).toHaveAttribute("href", "/admin?section=integrations");
});

test("adds a Kobo device with an absolute endpoint URL, then removes it", async ({
  page,
}) => {
  await gotoReady(page, DEVICES);

  const name = `E2E Kobo ${Date.now()}`;
  await page.getByTestId("kobo-device-name-input").fill(name);

  const { response } = await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/kobo/devices/create",
      expectedBody: { name },
      expectedStatus: 200,
    },
    async () => page.getByTestId("kobo-device-add").click(),
  );
  const created = await response.json();

  try {
    // The endpoint must be a full URL a Kobo on its own Wi-Fi can resolve,
    // not a bare path relative to the web app's own origin.
    await expect(page.getByTestId("kobo-endpoint-url").last()).toHaveValue(
      /^https?:\/\/[^/]+\/kobo\/[^/]+$/,
    );
    // The new device joins the list below the form it was added from.
    const row = page.getByTestId("kobo-device-row").filter({ hasText: name });
    const rowTop = (await row.boundingBox())?.y ?? 0;
    const addTop = (await page.getByTestId("kobo-device-add").boundingBox())?.y;
    expect(rowTop).toBeGreaterThan(addTop ?? Number.POSITIVE_INFINITY);

    // Regenerate asks first as well, and backing out sends nothing.
    const regenerates = recordRequests(
      page,
      "/api/rpc/kobo/devices/regenerate",
    );
    await page
      .getByRole("button", { name: `Regenerate token for ${name}` })
      .click();
    await expect(
      page.getByRole("dialog", { name: `Regenerate the token for ${name}?` }),
    ).toBeVisible();
    await page.getByTestId("kobo-regenerate-dialog-cancel").click();
    await expect(page.getByTestId("kobo-regenerate-dialog")).toHaveCount(0);
    expect(regenerates).toEqual([]);
  } finally {
    // Remove asks first, naming the device it would stop syncing.
    await page.getByRole("button", { name: `Remove ${name}` }).click();
    await expect(
      page.getByRole("dialog", { name: `Remove ${name}?` }),
    ).toBeVisible();
    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/kobo/devices/revoke",
        expectedBody: { id: created.id },
        expectedStatus: 200,
      },
      async () => page.getByTestId("kobo-remove-dialog-confirm").click(),
    );
    await expect(page.getByTestId("kobo-remove-dialog")).toHaveCount(0);
  }
});

// The device list is per-user state on the shared admin, so both disclosure
// states are stubbed, since whether it opens on its own depends on the list.
test("open the kobo setup steps from their disclosure", async ({ page }) => {
  await stubKoboDevices(page, [{ id: 1, name: "Kobo Clara" }]);
  await gotoReady(page, DEVICES);
  await expect(page.getByTestId("kobo-device-row")).toHaveCount(1);

  // A reader who already has a Kobo starts with the steps folded away.
  const steps = page.getByTestId("kobo-setup-steps");
  await expect(steps).toBeHidden();
  await page.getByText("How to connect a Kobo").click();
  await expect(steps).toBeVisible();
  await expect(
    steps.getByRole("link", { name: "omnibus-library/kobo-backup" }),
  ).toHaveAttribute("href", "https://github.com/omnibus-library/kobo-backup");
});

test("show the kobo setup steps to a reader with no kobo yet", async ({
  page,
}) => {
  await stubKoboDevices(page, []);
  await gotoReady(page, DEVICES);

  await expect(page.getByTestId("kobo-devices-empty")).toBeVisible();
  await expect(page.getByTestId("kobo-setup-steps")).toBeVisible();
});

test("the legacy /account route redirects into Settings", async ({ page }) => {
  await gotoReady(page, "/account");

  await expect(page).toHaveURL(/\/settings\??$/);
  await expect(page.getByTestId("account-profile-card")).toBeVisible();
});

test("saves the Kindle email and shows a success status", async ({ page }) => {
  await gotoReady(page, DEVICES);

  const address = "reader@kindle.com";
  await emailInput(page).fill(address);

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/account/kindle-email",
      expectedBody: { email: address },
      expectedStatus: 200,
    },
    async () => page.getByTestId("kindle-email-save").click(),
  );

  await expect(page.getByTestId("kindle-email-status")).toHaveText(
    "Kindle email saved.",
  );
  await expect(page.getByTestId("kindle-email-status")).toHaveClass(/success/);
});

test("clears the Kindle email only once the named address is confirmed", async ({
  page,
}) => {
  await gotoReady(page, DEVICES);
  const address = "reader@kindle.com";
  expect(
    await postFromPage(page, "/api/rpc/account/kindle-email", {
      email: address,
    }),
  ).toBe(200);
  await gotoReady(page, DEVICES);
  const writes = recordRequests(page, "/api/rpc/account/kindle-email");

  await page.getByTestId("kindle-email-clear").click();
  await expect(page.getByTestId("kindle-email-clear-dialog")).toContainText(
    address,
  );
  await page.getByTestId("kindle-email-clear-dialog-cancel").click();

  await expect(page.getByTestId("kindle-email-clear-dialog")).toHaveCount(0);
  expect(writes).toEqual([]);

  await page.getByTestId("kindle-email-clear").click();
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/account/kindle-email",
      expectedBody: { email: null },
      expectedStatus: 200,
    },
    async () => page.getByTestId("kindle-email-clear-dialog-confirm").click(),
  );
  await expect(page.getByTestId("kindle-email-clear-dialog")).toHaveCount(0);
  await expect(page.getByTestId("kindle-email-status")).toHaveText(
    "Kindle email cleared.",
  );
});

test("asks before revoking another session", async ({ page }) => {
  // The admin's sessions are shared by every spec, so the list is stubbed.
  const session = { kind: "cookie", created_at: 1, last_used_at: 1 };
  await page.route("**/api/auth/sessions", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: [
            {
              ...session,
              id: 1,
              client: "Firefox on Linux",
              expires_at: 4e9,
              is_current: true,
            },
            {
              ...session,
              id: 2,
              client: "Kobo Libra",
              expires_at: 4e9,
              is_current: false,
            },
          ],
        })
      : route.continue(),
  );
  await gotoReady(page, SECURITY);
  const revokes = recordRequests(page, "/api/auth/sessions/2");

  await page
    .getByRole("button", { name: "Revoke the session on Kobo Libra" })
    .click();
  await expect(page.getByTestId("session-revoke-dialog")).toBeVisible();
  await page.getByTestId("session-revoke-dialog-cancel").click();

  await expect(page.getByTestId("session-revoke-dialog")).toHaveCount(0);
  expect(revokes).toEqual([]);
});

test("shows an error status when saving the Kindle email fails", async ({
  page,
}) => {
  await gotoReady(page, DEVICES);

  await emailInput(page).fill("reader@kindle.com");

  await page.route("**/api/rpc/account/kindle-email", (route) => {
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
      url: "/api/rpc/account/kindle-email",
      expectedStatus: 500,
    },
    async () => page.getByTestId("kindle-email-save").click(),
  );

  await expect(page.getByTestId("kindle-email-status")).toHaveClass(/error/);
});

// Change-password (#1325). The success test mocks the mutation: the suite
// reuses this admin's credentials across every spec, so an actual password
// change would strand later `ensureLoggedIn` calls. The real DB behavior
// (verify current, validate new, stamp `password_changed_at`) is covered by
// the `omnibus-db` unit tests; the rejection tests below hit the live server
// and are safe because both reject *before* the write.

test("changes the password and clears the form on success", async ({
  page,
}) => {
  await gotoReady(page, SECURITY);

  await page.route("**/api/rpc/account/change-password", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    }
    return route.continue();
  });

  await currentPassword(page).fill(TEST_PASSWORD);
  await newPassword(page).fill("Brand-New-Valid-9x");

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/account/change-password",
      expectedBody: {
        current_password: TEST_PASSWORD,
        new_password: "Brand-New-Valid-9x",
      },
      expectedStatus: 200,
    },
    async () => page.getByTestId("change-password-submit").click(),
  );

  await expect(changeStatus(page)).toHaveText("Password changed.");
  await expect(changeStatus(page)).toHaveClass(/success/);
  await expect(currentPassword(page)).toHaveValue("");
  await expect(newPassword(page)).toHaveValue("");
});

test("rejects a wrong current password and leaves the form untouched", async ({
  page,
}) => {
  await gotoReady(page, SECURITY);

  await currentPassword(page).fill("definitely-not-the-password");
  await newPassword(page).fill("Brand-New-Valid-9x");

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/account/change-password",
      expectedBody: {
        current_password: "definitely-not-the-password",
        new_password: "Brand-New-Valid-9x",
      },
      expectedStatus: 500,
    },
    async () => page.getByTestId("change-password-submit").click(),
  );

  await expect(changeStatus(page)).toHaveClass(/error/);
  await expect(changeStatus(page)).toContainText(
    "current password is incorrect",
  );
  // Inputs keep their values so the user can correct just the current field.
  await expect(currentPassword(page)).toHaveValue(
    "definitely-not-the-password",
  );
});

test("rejects an invalid new password", async ({ page }) => {
  await gotoReady(page, SECURITY);

  // Correct current password authorizes; the too-short new password fails
  // policy on the server before any write happens.
  await currentPassword(page).fill(TEST_PASSWORD);
  await newPassword(page).fill("short");

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/account/change-password",
      expectedBody: { current_password: TEST_PASSWORD, new_password: "short" },
      expectedStatus: 500,
    },
    async () => page.getByTestId("change-password-submit").click(),
  );

  await expect(changeStatus(page)).toHaveClass(/error/);
});

// Display name (profile card). The seeded admin is shared across the parallel
// suite and the display name is globally visible — it relabels the wishlist
// shelf and every journal/rating byline — so the success test resets it in a
// `finally`, and the failure test mocks the response rather than writing.

test("saves the display name and shows a success status", async ({ page }) => {
  await gotoReady(page, PROFILE);

  try {
    await displayNameInput(page).fill("Seamus");

    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/account/profile",
        expectedBody: { display_name: "Seamus" },
        expectedStatus: 200,
      },
      async () => saveDisplayName(page).click(),
    );

    await expect(profileStatus(page)).toHaveText("Profile saved.");
    await expect(profileStatus(page)).toHaveClass(/success/);

    // The card re-reads `/api/auth/me` after the save, so the user menu shows
    // the new name without a reload.
    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByTestId("user-menu-panel")).toContainText("Seamus");
  } finally {
    await page.keyboard.press("Escape");
    await displayNameInput(page).fill("");
    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/rpc/account/profile",
        expectedBody: { display_name: null },
        expectedStatus: 200,
      },
      async () => saveDisplayName(page).click(),
    );
  }
});

test("shows an error status when saving the display name fails", async ({
  page,
}) => {
  await gotoReady(page, PROFILE);

  await displayNameInput(page).fill("Seamus");

  await page.route("**/api/rpc/account/profile", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "forced failure" }),
      });
    }
    return route.continue();
  });

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/account/profile",
      expectedStatus: 500,
    },
    async () => saveDisplayName(page).click(),
  );

  await expect(profileStatus(page)).toHaveClass(/error/);
});

test("offers Save display name only once the name changes", async ({
  page,
}) => {
  await gotoReady(page, PROFILE);
  const original = await displayNameInput(page).inputValue();

  await expect(saveDisplayName(page)).toBeDisabled();
  await displayNameInput(page).fill(`${original} draft`);
  await expect(saveDisplayName(page)).toBeEnabled();
  await displayNameInput(page).fill(original);
  await expect(saveDisplayName(page)).toBeDisabled();
});

test("asks before leaving an unsaved display name", async ({ page }) => {
  await gotoReady(page, PROFILE);
  await displayNameInput(page).fill("Unsaved name");

  await page.getByTestId("settings-nav-preferences").click();
  await expect(page.getByTestId("unsaved-confirm")).toBeVisible();
  await page.getByTestId("unsaved-keep").click();
  await expect(page).toHaveURL(/section=profile$/);
  await expect(displayNameInput(page)).toHaveValue("Unsaved name");

  await page.getByTestId("settings-nav-preferences").click();
  await page.getByTestId("unsaved-discard").click();
  await expect(page).toHaveURL(/section=preferences$/);
});

test("stay on the open section when its own link is clicked over edits", async ({
  page,
}) => {
  await gotoReady(page, PROFILE);
  await displayNameInput(page).fill("Unsaved name");

  await page.getByTestId("settings-nav-profile").click();

  await expect(page.getByTestId("unsaved-confirm")).toHaveCount(0);
  await expect(displayNameInput(page)).toHaveValue("Unsaved name");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ask before the back link drops unsaved goals", async ({ page }) => {
    await gotoReady(page, GOALS);
    await page.getByTestId("goal-pages-input").fill("42");

    await page.getByTestId("settings-back").click();
    await expect(page.getByTestId("unsaved-confirm")).toBeVisible();
    await page.getByTestId("unsaved-keep").click();

    await expect(page).toHaveURL(/section=goals$/);
    await expect(page.getByTestId("goal-pages-input")).toHaveValue("42");
  });

  test("go back from the default section without asking", async ({ page }) => {
    await gotoReady(page, PROFILE);
    await displayNameInput(page).fill("Unsaved name");

    await page.getByTestId("settings-back").click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("unsaved-confirm")).toHaveCount(0);
  });
});

test("confirms a replaced avatar and clears it when the next upload starts", async ({
  page,
}) => {
  await gotoReady(page, PROFILE);

  // Stubbed: the admin's real avatar would show in every other spec's menu.
  let answer = 204;
  await page.route("**/api/account/avatar", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: answer, body: "" });
    }
    return route.continue();
  });
  const pick = () =>
    page.getByTestId("avatar-file-input").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });

  await expectMutation(
    page,
    { method: "POST", url: "/api/account/avatar", expectedStatus: 204 },
    pick,
  );
  await expect(profileStatus(page)).toHaveText("Profile picture saved.");
  await expect(profileStatus(page)).toHaveClass(/success/);

  // A confirmation left from the last write must not pass for this one's.
  answer = 400;
  await expectMutation(
    page,
    { method: "POST", url: "/api/account/avatar", expectedStatus: 400 },
    pick,
  );
  await expect(page.getByTestId("avatar-status")).toHaveClass(/error/);
  await expect(profileStatus(page)).toBeEmpty();
});

test("shows an error when the avatar upload fails", async ({ page }) => {
  await gotoReady(page, PROFILE);

  await page.route("**/api/account/avatar", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 400,
        contentType: "text/plain",
        body: "unsupported image type",
      });
    }
    return route.continue();
  });

  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/account/avatar",
      expectedStatus: 400,
    },
    async () =>
      page.getByTestId("avatar-file-input").setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      }),
  );

  await expect(page.getByTestId("avatar-status")).toBeVisible();
  await expect(page.getByTestId("avatar-status")).toHaveClass(/error/);
});

// The five goal tests all reset the same three per-user rows, so they have to
// run one at a time — under the suite's `fullyParallel` default they clobber
// each other's state mid-assertion. Scoped to this block rather than the file,
// so the rest of the account surface keeps its parallelism.
test.describe
  .serial("reading goals", () => {
    /**
     * Seed one goal through the REST route, asserting it landed. A silent
     * setup failure — a moved route, an auth regression — would otherwise
     * surface as a confusing assertion about the UI rather than the setup.
     */
    async function seedGoal(
      request: APIRequestContext,
      path: string,
      data: Record<string, unknown>,
    ) {
      const resp = await request.put(path, { data });
      expect(resp.status(), `seeding ${path} failed`).toBe(200);
    }

    /**
     * Reset every goal so each test below starts from the not-set state. The REST
     * writes invalidate this user's stats cache, so the card reads the cleared
     * values immediately rather than after the TTL.
     */
    async function clearAllGoals(request: APIRequestContext) {
      const annual = await request.put("/api/stats/goal", {
        data: { target: null },
      });
      expect(annual.status(), "clearing the reading goal failed").toBe(200);
      for (const kind of ["pages", "minutes"]) {
        const resp = await request.put("/api/stats/goal/daily", {
          data: { kind, target: null },
        });
        expect(resp.status(), `clearing the daily ${kind} goal failed`).toBe(
          200,
        );
      }
    }

    const goalInput = (page: Page, kind: string) =>
      page.getByTestId(`goal-${kind}-input`);
    const saveAll = (page: Page) => page.getByTestId("goals-save");

    test("edit goals inline and save all", async ({ page, request }) => {
      await clearAllGoals(request);
      await gotoReady(page, GOALS);

      const card = page.getByTestId("account-goals-card");
      await expect(
        card.getByRole("heading", { level: 3, name: "Reading goals" }),
      ).toBeVisible();
      // Always a form: three fields and one Save all, which waits for a change.
      for (const kind of ["books", "pages", "minutes"]) {
        await expect(goalInput(page, kind)).toBeEnabled();
        await expect(goalInput(page, kind)).toHaveValue("");
      }
      await expect(card.getByRole("button")).toHaveCount(1);
      await expect(saveAll(page)).toHaveText("Save all");
      await expect(saveAll(page)).toBeDisabled();

      await goalInput(page, "books").fill("24");
      await goalInput(page, "pages").fill("30");
      await goalInput(page, "minutes").fill("45");
      await expect(saveAll(page)).toBeEnabled();

      // One Save all makes three per-kind writes. The annual and daily routes
      // can't be batched, so the card fans out and reports what landed.
      await expectMutation(
        page,
        {
          method: "POST",
          url: "/api/rpc/stats-goal",
          // `utc_offset_minutes` is the browser's own offset, which the config
          // pins to UTC (`timezoneId`) so this is deterministically 0 — it is
          // where the server cuts the answer's day boundaries (rule 10).
          expectedBody: { update: { target: 24 }, utc_offset_minutes: 0 },
          expectedStatus: 200,
        },
        async () => saveAll(page).click(),
      );

      await expect(page.getByTestId("goals-status")).toHaveText("Goals saved.");
      await expect(saveAll(page)).toBeDisabled();

      // They survive a reload — the card reads all three back off the server,
      // which is what tells an optimistic render apart from a real write.
      await gotoReady(page, GOALS);
      await expect(goalInput(page, "books")).toHaveValue("24");
      await expect(goalInput(page, "pages")).toHaveValue("30");
      await expect(goalInput(page, "minutes")).toHaveValue("45");
    });

    test("an emptied field clears that goal and leaves the others alone", async ({
      page,
      request,
    }) => {
      await clearAllGoals(request);
      await seedGoal(request, "/api/stats/goal", { target: 24 });
      await seedGoal(request, "/api/stats/goal/daily", {
        kind: "pages",
        target: 30,
      });
      await gotoReady(page, GOALS);
      await expect(goalInput(page, "pages")).toHaveValue("30");

      // Blanking is how the form drops a goal. There is no Clear per row.
      await goalInput(page, "pages").fill("");

      await expectMutation(
        page,
        {
          method: "POST",
          url: "/api/rpc/stats-goal-daily",
          // `target` is `skip_serializing_if = "Option::is_none"`, so a clear
          // travels as the kind alone — same shape the annual clear uses. The
          // offset rides every stats write; the config pins it to 0.
          expectedBody: { update: { kind: "pages" }, utc_offset_minutes: 0 },
          expectedStatus: 200,
        },
        async () => saveAll(page).click(),
      );
      await expect(page.getByTestId("goals-status")).toHaveText("Goals saved.");

      // The untouched annual target is not restated — only changed kinds are
      // written, so another device's value can't be clobbered by a no-op save.
      await gotoReady(page, GOALS);
      await expect(goalInput(page, "books")).toHaveValue("24");
      await expect(goalInput(page, "pages")).toHaveValue("");
    });

    test("an out-of-range target is refused before it costs a round trip", async ({
      page,
      request,
    }) => {
      await clearAllGoals(request);
      await gotoReady(page, GOALS);

      // 1,500 is a legal day of pages and an impossible day of minutes, so the
      // same number has to be accepted by one field and refused by the other.
      await goalInput(page, "pages").fill("1500");
      await goalInput(page, "minutes").fill("1500");
      await saveAll(page).click();

      await expect(page.getByTestId("goal-minutes-error")).toContainText(
        "1440",
      );
      await expect(goalInput(page, "minutes")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.getByTestId("goal-pages-error")).toHaveCount(0);
      await expect(page.getByTestId("goals-status")).toContainText(
        "Nothing saved",
      );
      // Nothing was written, and the form keeps the value it rejected.
      await expect(goalInput(page, "pages")).toHaveValue("1500");
    });

    test("a failed save names the kind that didn't land", async ({
      page,
      request,
    }) => {
      await clearAllGoals(request);
      await page.route("**/api/rpc/stats-goal-daily", (route) =>
        route.fulfill({ status: 500, contentType: "text/plain", body: "boom" }),
      );

      await gotoReady(page, GOALS);
      await goalInput(page, "books").fill("24");
      await goalInput(page, "pages").fill("30");
      await saveAll(page).click();

      // Three goals are three writes: the reader has to know which one to retry
      // rather than being told "something went wrong".
      const status = page.getByTestId("goals-status");
      await expect(status).toContainText("Pages a day");
      await expect(status).toHaveClass(/error/);
      await expect(page.getByTestId("goal-pages-error")).toBeVisible();
      // The annual write did land; the failed kind keeps its draft to retry.
      await expect(goalInput(page, "books")).toHaveValue("24");
      await expect(goalInput(page, "pages")).toHaveValue("30");
      await expect(saveAll(page)).toBeEnabled();
    });

    test("asks before leaving unsaved goals", async ({ page, request }) => {
      await clearAllGoals(request);
      await seedGoal(request, "/api/stats/goal", { target: 24 });
      await gotoReady(page, GOALS);
      await expect(goalInput(page, "books")).toHaveValue("24");

      await goalInput(page, "books").fill("99");
      await page.getByTestId("settings-nav-profile").click();
      await expect(page.getByTestId("unsaved-confirm")).toBeVisible();
      await page.getByTestId("unsaved-keep").click();
      await expect(goalInput(page, "books")).toHaveValue("99");

      // Typing the saved value back leaves nothing to lose.
      await goalInput(page, "books").fill("24");
      await expect(saveAll(page)).toBeDisabled();
      await page.getByTestId("settings-nav-profile").click();
      await expect(page).toHaveURL(/section=profile$/);
    });
  });

// The shared admin's share-stats flag is per-account state every other spec
// (and the layout test above) reads as "on" — serialized so no other test in
// this file observes it mid-flip, and reset to on both before and after.
test.describe
  .serial("share stats", () => {
    /**
     * Set the caller's `share_stats` preference, asserting it landed, as
     * `presetScrollStops` does. A silent setup failure would otherwise surface
     * as a confusing assertion about which state rendered.
     */
    async function setShareStats(request: APIRequestContext, enabled: boolean) {
      const resp = await request.post("/api/account/share-stats", {
        data: { enabled },
      });
      expect(resp.status(), `setting share stats to ${enabled} failed`).toBe(
        200,
      );
    }

    test.beforeEach(async ({ request }) => {
      await setShareStats(request, true);
    });
    test.afterEach(async ({ request }) => {
      await setShareStats(request, true);
    });

    const shareStatsSwitch = (page: Page) =>
      page.getByRole("switch", { name: "Share stats with household" });
    const shareStatsStatus = (page: Page) =>
      page.getByTestId("share-stats-status");

    test("turning share stats off saves and survives a reload", async ({
      page,
    }) => {
      await gotoReady(page, PREFERENCES);

      await expect(shareStatsSwitch(page)).toBeChecked();
      await expect(page.getByTestId("user-setting-share-stats")).toContainText(
        "On by default.",
      );

      await expectMutation(
        page,
        {
          method: "POST",
          url: "/api/rpc/account/share-stats",
          expectedBody: { enabled: false },
          expectedStatus: 200,
        },
        async () => shareStatsSwitch(page).click(),
      );

      await expect(shareStatsSwitch(page)).not.toBeChecked();
      await expect(shareStatsStatus(page)).toHaveText("Saved");

      await gotoReady(page, PREFERENCES);
      await expect(shareStatsSwitch(page)).not.toBeChecked();
    });

    test("a failed share-stats save puts the switch back and shows the error", async ({
      page,
    }) => {
      await gotoReady(page, PREFERENCES);
      await expect(shareStatsSwitch(page)).toBeChecked();

      await page.route("**/api/rpc/account/share-stats", (route) => {
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
          url: "/api/rpc/account/share-stats",
          expectedBody: { enabled: false },
          expectedStatus: 500,
        },
        async () => shareStatsSwitch(page).click(),
      );

      await expect(shareStatsSwitch(page)).toBeChecked();
      await expect(shareStatsStatus(page)).toHaveText(
        "Couldn’t save. Try again.",
      );
      await expect(shareStatsStatus(page)).toHaveClass(/error/);
    });
  });

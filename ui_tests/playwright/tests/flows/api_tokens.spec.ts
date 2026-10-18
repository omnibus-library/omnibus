import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { expectNavVisible, gotoReady } from "../utils/nav";

// Settings › Sign-in & security → API tokens (#2313, redesigned in #2330):
// per-user long-lived `omni_…` bearers with a create-once secret hand-off
// (copy buttons that report whether the copy landed, an explicit dismiss), a
// token table with status pills and `omni_…xxxx` identifiers, in-row rename,
// and in-row revoke confirmation. Tokens are per-user state on the shared
// seeded admin, so every test names its tokens uniquely and revokes what it
// created. Counts are never asserted, only presence/absence of this test's
// own rows.
const SETTINGS_API_TOKENS = "/settings?section=security";

const nameInput = (page: Page) => page.getByTestId("api-token-name-input");
const createButton = (page: Page) => page.getByTestId("api-token-create");
const secretPanel = (page: Page) => page.getByTestId("api-token-secret-field");
const secretField = (page: Page) => page.getByTestId("api-token-secret");
const status = (page: Page) => page.getByTestId("api-tokens-status");

const rowFor = (page: Page, name: string) =>
  page.getByTestId("api-token-row").filter({ hasText: name });

async function createToken(page: Page, name: string): Promise<void> {
  await nameInput(page).fill(name);
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/api-tokens/create",
      expectedBody: { name },
      expectedStatus: 200,
    },
    async () => createButton(page).click(),
  );
}

// Revoke is two-step: the row's Revoke swaps in a confirmation row, and only
// its "Revoke token" fires the mutation.
async function revokeToken(page: Page, name: string): Promise<void> {
  await rowFor(page, name)
    .getByRole("button", { name: `Revoke ${name}`, exact: true })
    .click();
  const confirm = page.getByTestId("api-token-revoke-confirm");
  await expect(confirm).toBeVisible();
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/api-tokens/revoke",
      expectedStatus: 200,
    },
    async () => confirm.getByRole("button", { name: "Revoke token" }).click(),
  );
  await expect(rowFor(page, name)).toHaveCount(0);
}

test("renders the API tokens section layout", async ({ page }) => {
  await gotoReady(page, SETTINGS_API_TOKENS);

  await expectNavVisible(page);
  await expect(page.getByTestId("api-tokens-card")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "API tokens" }),
  ).toBeVisible();
  // The head states the live-token count and the account's blast radius —
  // the seeded admin always carries the Admin chip.
  await expect(page.getByTestId("api-tokens-count")).toContainText("live");
  await expect(page.getByTestId("api-tokens-scope")).toContainText("Admin");
  await expect(nameInput(page)).toBeVisible();
  await expect(createButton(page)).toBeVisible();
  // No secret surface exists before a create — the secret only ever renders
  // once, immediately after minting.
  await expect(secretPanel(page)).toHaveCount(0);
});

test("creates a token, hands off the secret exactly once, and revokes it", async ({
  page,
}) => {
  const name = `e2e once ${Date.now()}`;
  await gotoReady(page, SETTINGS_API_TOKENS);

  await createToken(page, name);

  // The hand-off panel is displayed now: the omni_-prefixed secret, its copy
  // button, and the pre-filled `claude mcp add` command carrying the same
  // secret and this instance's origin.
  await expect(secretPanel(page)).toBeVisible();
  const secret = (await secretField(page).textContent()) ?? "";
  expect(secret).toMatch(/^omni_/);
  await expect(page.getByTestId("api-token-secret-copy")).toBeVisible();
  const command = page.getByTestId("api-token-mcp-command");
  await expect(command).toContainText(secret);
  await expect(command).toContainText(`${new URL(page.url()).origin}/mcp`);
  await expect(page.getByTestId("api-token-mcp-command-copy")).toBeVisible();

  // The form stays on top; the secret lands directly under it and the new
  // row joins the list below, rather than appearing above where it was made.
  const row = rowFor(page, name);
  await expect(row).toBeVisible();
  await expect(nameInput(page)).toBeVisible();
  const top = async (l: Locator) => (await l.boundingBox())?.y ?? Number.NaN;
  const formTop = await top(createButton(page));
  const secretTop = await top(secretPanel(page));
  expect(secretTop).toBeGreaterThan(formTop);
  expect(await top(row)).toBeGreaterThan(secretTop);

  // The row lists the token with its omni_…xxxx identifier and the
  // never-used pill.
  await expect(row.getByText(`omni_…${secret.slice(-4)}`)).toBeVisible();
  await expect(row.getByTestId("api-token-pill")).toHaveText("Never used");

  // The live status line announces the hand-off.
  await expect(status(page)).toContainText("Token created.");

  // Dismissing hides the secret for good.
  await page.getByRole("button", { name: "Hide secret" }).click();
  await expect(secretPanel(page)).toHaveCount(0);

  // After a reload the secret is unrecoverable: the row persists, the
  // secret surface does not.
  await gotoReady(page, SETTINGS_API_TOKENS);
  await expect(rowFor(page, name)).toBeVisible();
  await expect(secretPanel(page)).toHaveCount(0);

  await revokeToken(page, name);
});

test("cancels an in-row revoke confirmation without revoking", async ({
  page,
}) => {
  const name = `e2e cancel ${Date.now()}`;
  await gotoReady(page, SETTINGS_API_TOKENS);
  await createToken(page, name);
  await page.getByTestId("api-token-secret-dismiss").click();

  await rowFor(page, name)
    .getByRole("button", { name: `Revoke ${name}`, exact: true })
    .click();
  const confirm = page.getByTestId("api-token-revoke-confirm");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(rowFor(page, name)).toBeVisible();

  await revokeToken(page, name);
});

test("renames a token in place", async ({ page }) => {
  const name = `e2e rename ${Date.now()}`;
  const renamed = `${name} v2`;
  await gotoReady(page, SETTINGS_API_TOKENS);
  await createToken(page, name);
  await page.getByTestId("api-token-secret-dismiss").click();

  await rowFor(page, name)
    .getByRole("button", { name: `Rename ${name}`, exact: true })
    .click();
  const input = page.getByTestId("api-token-rename-input");
  await expect(input).toHaveValue(name);
  await input.fill(renamed);
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/api-tokens/rename",
      expectedStatus: 200,
    },
    async () => page.getByTestId("api-token-rename-save").click(),
  );
  await expect(rowFor(page, renamed)).toBeVisible();

  // The rename survives a reload — it persisted, not just re-rendered.
  await gotoReady(page, SETTINGS_API_TOKENS);
  await expect(rowFor(page, renamed)).toBeVisible();

  await revokeToken(page, renamed);
});

test("shows an error and keeps the list unchanged when creation fails", async ({
  page,
}) => {
  const name = `e2e fail ${Date.now()}`;
  await gotoReady(page, SETTINGS_API_TOKENS);

  await page.route("**/api/rpc/api-tokens/create", (route) =>
    route.fulfill({ status: 500, body: "internal server error" }),
  );
  await nameInput(page).fill(name);
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/api-tokens/create",
      expectedBody: { name },
      expectedStatus: 500,
    },
    async () => createButton(page).click(),
  );

  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveClass(/error/);
  await expect(secretPanel(page)).toHaveCount(0);
  await expect(rowFor(page, name)).toHaveCount(0);
});

test("shows an error and keeps the row when rename fails", async ({ page }) => {
  const name = `e2e rename-fail ${Date.now()}`;
  await gotoReady(page, SETTINGS_API_TOKENS);
  await createToken(page, name);
  await page.getByTestId("api-token-secret-dismiss").click();

  await page.route("**/api/rpc/api-tokens/rename", (route) =>
    route.fulfill({ status: 500, body: "internal server error" }),
  );
  await rowFor(page, name)
    .getByRole("button", { name: `Rename ${name}`, exact: true })
    .click();
  await page.getByTestId("api-token-rename-input").fill(`${name} v2`);
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/api-tokens/rename",
      expectedStatus: 500,
    },
    async () => page.getByTestId("api-token-rename-save").click(),
  );

  // The error surfaces, the edit row stays open, and cancelling reveals the
  // row still under its original name.
  await expect(status(page)).toHaveClass(/error/);
  await page.getByTestId("api-token-rename-cancel").click();
  await expect(rowFor(page, name)).toBeVisible();

  await page.unroute("**/api/rpc/api-tokens/rename");
  await revokeToken(page, name);
});

test("shows an error and keeps the row when revoke fails", async ({ page }) => {
  const name = `e2e revoke-fail ${Date.now()}`;
  await gotoReady(page, SETTINGS_API_TOKENS);
  await createToken(page, name);
  await page.getByTestId("api-token-secret-dismiss").click();

  await page.route("**/api/rpc/api-tokens/revoke", (route) =>
    route.fulfill({ status: 500, body: "internal server error" }),
  );
  await rowFor(page, name)
    .getByRole("button", { name: `Revoke ${name}`, exact: true })
    .click();
  const confirm = page.getByTestId("api-token-revoke-confirm");
  await expect(confirm).toBeVisible();
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/rpc/api-tokens/revoke",
      expectedStatus: 500,
    },
    async () => confirm.getByRole("button", { name: "Revoke token" }).click(),
  );

  // The error surfaces and the token survives — cancel back to the row.
  await expect(status(page)).toHaveClass(/error/);
  await page.getByTestId("api-token-revoke-cancel").click();
  await expect(rowFor(page, name)).toBeVisible();

  await page.unroute("**/api/rpc/api-tokens/revoke");
  await revokeToken(page, name);
});

// ── Copying the secret ──────────────────────────────────────────────
// The copy must say whether it landed. On a plain-http LAN install there is
// no `navigator.clipboard`, and a silent failure there loses the secret.

test.describe("copying the secret", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copies the secret and says so", async ({ page }) => {
    const name = `e2e copy ${Date.now()}`;
    await gotoReady(page, SETTINGS_API_TOKENS);
    await createToken(page, name);
    const secret = (await secretField(page).textContent()) ?? "";

    await page.getByTestId("api-token-secret-copy").click();

    await expect(page.getByTestId("api-token-secret-copy-feedback")).toHaveText(
      "Copied",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      secret,
    );

    await page.getByTestId("api-token-secret-dismiss").click();
    await revokeToken(page, name);
  });
});

test("says so when the secret can't be copied", async ({ page }) => {
  // No clipboard API (as on plain http) and a refused fallback copy.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
    document.execCommand = () => false;
  });
  const name = `e2e copy-fail ${Date.now()}`;
  await gotoReady(page, SETTINGS_API_TOKENS);
  await createToken(page, name);

  await page.getByTestId("api-token-secret-copy").click();

  const feedback = page.getByTestId("api-token-secret-copy-feedback");
  await expect(feedback).toHaveText("Couldn\u2019t copy. Select and copy it.");
  await expect(feedback).toHaveClass(/error/);
  await expect(secretPanel(page)).toBeVisible();

  await page.getByTestId("api-token-secret-dismiss").click();
  await revokeToken(page, name);
});

// ── Hosted MCP endpoint toggle (#2314) ──────────────────────────────
// Lives under Administration › Integrations, admin-only (the seeded user is
// an admin). The toggle is instance-wide state. The action test flips it on
// and restores it off (the shipped default) before finishing, and no other
// spec touches /mcp, so nothing else in the suite reads it.

const ADMIN_INTEGRATIONS = "/admin?section=integrations";

const mcpToggle = (page: Page) => page.getByTestId("mcp-toggle");
const mcpState = (page: Page) => page.getByTestId("mcp-toggle-state");

test("renders the MCP endpoint toggle card for an admin", async ({ page }) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);

  await expect(page.getByTestId("mcp-toggle-card")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hosted MCP endpoint" }),
  ).toBeVisible();
  await expect(mcpState(page)).toBeVisible();
  // The copyable endpoint URL carries this instance's origin.
  await expect(page.getByTestId("mcp-endpoint-url")).toHaveText(
    `${new URL(page.url()).origin}/mcp`,
  );
  // The card waits for the status read before offering the switch.
  await expect(mcpToggle(page)).toBeEnabled();
});

test("enables and disables the MCP endpoint", async ({ page }) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);
  await expect(mcpToggle(page)).toBeEnabled();

  try {
    // The dev instance ships with the toggle off; flip on, then restore.
    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/settings/mcp",
        expectedBody: { enabled: true },
        expectedStatus: 204,
      },
      async () => mcpToggle(page).click(),
    );
    await expect(page.getByTestId("mcp-toggle-status")).toHaveClass(/success/);
    await expect(mcpState(page)).toHaveText("enabled");
    await expect(mcpToggle(page)).toHaveAttribute("aria-checked", "true");

    await expectMutation(
      page,
      {
        method: "POST",
        url: "/api/settings/mcp",
        expectedBody: { enabled: false },
        expectedStatus: 204,
      },
      async () => mcpToggle(page).click(),
    );
    await expect(mcpState(page)).toHaveText("disabled");
    await expect(mcpToggle(page)).toHaveAttribute("aria-checked", "false");
  } finally {
    // Failure-safe restore of the instance-wide default: a mid-test failure
    // must not leave /mcp enabled for the rest of the suite. Direct API
    // write (idempotent) — the UI's state is unknowable after a failure.
    await page.request.post("/api/settings/mcp", {
      data: { enabled: false },
    });
  }
});

test("shows an error and keeps the switch state when the toggle fails", async ({
  page,
}) => {
  await gotoReady(page, ADMIN_INTEGRATIONS);
  await expect(mcpToggle(page)).toBeEnabled();

  // Fail only the POST — the card's status GET on mount shares the URL.
  await page.route("**/api/settings/mcp", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 500, body: "internal server error" });
    }
    return route.continue();
  });
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/settings/mcp",
      expectedBody: { enabled: true },
      expectedStatus: 500,
    },
    async () => mcpToggle(page).click(),
  );

  await expect(page.getByTestId("mcp-toggle-status")).toHaveClass(/error/);
  await expect(mcpState(page)).toHaveText("disabled");
  await expect(mcpToggle(page)).toHaveAttribute("aria-checked", "false");
});

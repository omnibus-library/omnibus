import type { Page } from "@playwright/test";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { fetchBookUuidByTitle, switchToTableView } from "../utils/ebooks";
import { expectNavVisible, gotoReady } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Stack series (#2634): a per-user preference that folds each series of two
// or more books into one grid tile. It is saved on the account, so — like
// hidden_formats.spec.ts — this spec provisions its OWN user on a cookie-less
// context: stacking the shared admin would fold the Pioneers and Code Quartet
// volumes out from under landing.spec.ts's tile counts in a parallel worker.
// Every fixture here is only read.
const STACK_USER = "stackseries";
const STACK_PASSWORD = "stack-series-pw-00";
const SAVE_URL = "/api/rpc/account/stack-series";

const PIONEERS = ["beta", "gamma", "pioneers-3", "pioneers-4", "pioneers-5"];
const CODE_QUARTET = [
  "code-quartet-1",
  "code-quartet-2",
  "code-quartet-3",
  "code-quartet-4",
];

const stackToggle = (page: Page) =>
  page.getByRole("button", { name: "Stack series" });
const stackTiles = (page: Page) => page.getByTestId(/^series-stack-/);
const pioneersStack = (page: Page) =>
  page.getByRole("button", { name: "Pioneers, 5 books" });
const volumeTile = (page: Page, slug: string) =>
  page.getByTestId(`ebook-tile-${slug}`);

// The tests walk one account's preference through its states in order.
test.describe.configure({ mode: "serial" });

let stacker: Page;

test.beforeAll(async ({ browser, request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  const created = await request.post("/api/users", {
    data: {
      username: STACK_USER,
      password: STACK_PASSWORD,
      permissions: {
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: true,
      },
    },
  });
  expect([201, 409]).toContain(created.status());

  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  stacker = await context.newPage();
  await logIn(stacker);
  // A rerun after a failure may find the account still stacked.
  await setStacking(stacker, false);
});

test.afterAll(async () => {
  // Leave the account on the default however the tests ended.
  await setStacking(stacker, false);
  await stacker.context().close();
});

/** Log the dedicated user in through the login UI. */
async function logIn(page: Page): Promise<void> {
  await gotoReady(page, "/login");
  await page.getByLabel("Username").fill(STACK_USER);
  await page.getByLabel("Password").fill(STACK_PASSWORD);
  await expectMutation(
    page,
    { method: "POST", url: "/api/auth/login", expectedStatus: 200 },
    async () => page.getByRole("button", { name: "Log in" }).click(),
  );
  await expect(page).toHaveURL(/\/$/);
}

/** Save Stack series through the toolbar switch unless it already reads `on`. */
async function setStacking(page: Page, on: boolean): Promise<void> {
  await gotoReady(page, "/");
  // Enabled only once `/me` resolves, so aria-pressed is the saved value.
  await expect(stackToggle(page)).toBeEnabled();
  if ((await stackToggle(page).getAttribute("aria-pressed")) === String(on)) {
    return;
  }
  await expectMutation(
    page,
    {
      method: "POST",
      url: SAVE_URL,
      expectedBody: { enabled: on },
      expectedStatus: 200,
    },
    async () => stackToggle(page).click(),
  );
  await expect(stackToggle(page)).toHaveAttribute("aria-pressed", String(on));
}

test("renders the stack series switch off with every volume tiled", async () => {
  await gotoReady(stacker, "/");

  await expect(stackToggle(stacker)).toBeEnabled();
  await expect(stackToggle(stacker)).toHaveAttribute("aria-pressed", "false");
  await expect(stackTiles(stacker)).toHaveCount(0);
  for (const slug of PIONEERS) {
    await expect(volumeTile(stacker, slug)).toBeVisible();
  }
  await expectNavVisible(stacker);
});

test("turning stack series on folds each series into one counted tile", async () => {
  await gotoReady(stacker, "/");
  await expect(stackToggle(stacker)).toBeEnabled();

  await expectMutation(
    stacker,
    {
      method: "POST",
      url: SAVE_URL,
      expectedBody: { enabled: true },
      expectedStatus: 200,
    },
    async () => stackToggle(stacker).click(),
  );

  await expect(stackToggle(stacker)).toHaveAttribute("aria-pressed", "true");
  await expect(pioneersStack(stacker)).toContainText("5 books");
  await expect(
    stacker.getByRole("button", { name: "Code Quartet, 4 books" }),
  ).toContainText("4 books");
  for (const slug of [...PIONEERS, ...CODE_QUARTET]) {
    await expect(volumeTile(stacker, slug)).toHaveCount(0);
  }
});

test("opening a stack deals its volumes out behind a head card and escape folds it", async () => {
  await gotoReady(stacker, "/");
  await pioneersStack(stacker).click();

  const cap = stacker.getByTestId("series-cap");
  await expect(cap).toBeVisible();
  await expect(cap).toContainText("Pioneers");
  await expect(cap).toContainText("5 in your library");
  for (const slug of PIONEERS) {
    await expect(volumeTile(stacker, slug)).toBeVisible();
  }
  await expect(stacker.getByRole("button", { name: /Fold up/ })).toBeFocused();

  await stacker.keyboard.press("Escape");

  await expect(cap).toHaveCount(0);
  await expect(pioneersStack(stacker)).toBeVisible();
  for (const slug of PIONEERS) {
    await expect(volumeTile(stacker, slug)).toHaveCount(0);
  }
});

test("opening a stack moves the rest of the wall rather than rebuilding it", async () => {
  await gotoReady(stacker, "/");
  const grid = stacker.getByTestId("lib-grid");
  // A cell the diff re-creates loses this mark; a moved one keeps it.
  await grid.evaluate((g) => {
    for (const cell of g.children) cell.setAttribute("data-e2e-kept", "");
  });

  await pioneersStack(stacker).click();
  await expect(stacker.getByTestId("series-cap")).toBeVisible();

  const fresh = await grid.evaluate(
    (g) => g.querySelectorAll(":scope > :not([data-e2e-kept])").length,
  );
  expect(fresh).toBe(1 + PIONEERS.length);
  // The deal-out motion owns a volume's entrance, not the wall's sweep-in.
  await expect(volumeTile(stacker, "beta")).toHaveCSS("animation-name", "none");
});

test("a sort change never reopens a run or moves focus", async ({
  request,
}) => {
  const asc = `stack-${await fetchBookUuidByTitle(request, "Beta in the Series")}`;
  const desc = `stack-${await fetchBookUuidByTitle(request, "Pioneers Vol 5: Signal")}`;
  // The folded Pioneers stack's lead, which moves with the sort; null while dealt out.
  const lead = () =>
    stacker.evaluate(
      () =>
        document
          .querySelector('[aria-label="Pioneers, 5 books"]')
          ?.closest("[data-flip-key]")
          ?.getAttribute("data-flip-key") ?? null,
    );
  const sortDir = stacker.getByTestId("lib-sort-dir");
  const flipTo = async (key: string) => {
    await sortDir.click();
    await expect.poll(lead).toBe(key);
  };

  await gotoReady(stacker, "/");
  await expect(sortDir).toHaveText("↑");
  await expect.poll(lead).toBe(asc);
  await pioneersStack(stacker).click();
  await expect(stacker.getByTestId("series-cap")).toBeVisible();

  await flipTo(desc);
  await flipTo(asc);
  await expect(stacker.getByTestId("series-cap")).toHaveCount(0);
  await expect(sortDir).toBeFocused();

  // A fold's refocus is spent on the tile it returns to.
  await pioneersStack(stacker).click();
  await stacker.keyboard.press("Escape");
  await expect(pioneersStack(stacker)).toBeFocused();
  await flipTo(desc);
  await flipTo(asc);
  await expect(sortDir).toBeFocused();
});

test("the head card links to the series page", async () => {
  await gotoReady(stacker, "/");
  await pioneersStack(stacker).click();

  await stacker.getByRole("link", { name: "Series page →" }).click();

  await expect(stacker).toHaveURL(/\/series\/\d+$/);
  await expect(stacker.getByRole("heading", { level: 1 })).toContainText(
    "Pioneers",
  );
});

test("table view disables the switch and says it is grid only", async () => {
  await gotoReady(stacker, "/");
  await switchToTableView(stacker);

  await expect(stackToggle(stacker)).toBeDisabled();
  await expect(stacker.getByTestId("lib-stack-note")).toHaveText("Grid only");

  // Inert, not off: the saved choice comes back with the grid.
  await stacker.getByTestId("view-toggle-grid").click();
  await expect(stackToggle(stacker)).toBeEnabled();
  await expect(stackToggle(stacker)).toHaveAttribute("aria-pressed", "true");
  await expect(pioneersStack(stacker)).toBeVisible();
});

test("the switch is saved per user and survives a reload", async ({
  page: adminPage,
}) => {
  await gotoReady(stacker, "/");
  await stacker.reload();
  await stacker.waitForLoadState("networkidle");

  await expect(stackToggle(stacker)).toHaveAttribute("aria-pressed", "true");
  await expect(pioneersStack(stacker)).toBeVisible();

  // The shared admin never stacked, so its wall still tiles every volume.
  await gotoReady(adminPage, "/");
  await expect(volumeTile(adminPage, "beta")).toBeVisible();
  await expect(stackTiles(adminPage)).toHaveCount(0);
});

test("a failed save puts the switch back and says so", async () => {
  await setStacking(stacker, true);
  await stacker.route(`**${SAVE_URL}`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "forced failure",
    }),
  );
  try {
    await expectMutation(
      stacker,
      {
        method: "POST",
        url: SAVE_URL,
        expectedBody: { enabled: false },
        expectedStatus: 500,
      },
      async () => stackToggle(stacker).click(),
    );

    await expect(stackToggle(stacker)).toHaveAttribute("aria-pressed", "true");
    await expect(stacker.getByTestId("lib-stack-error")).toBeVisible();
    await expect(pioneersStack(stacker)).toBeVisible();
  } finally {
    await stacker.unroute(`**${SAVE_URL}`);
  }
});

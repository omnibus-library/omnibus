// The household reader picker on /stats: choosing another sharing reader,
// seeing their figures under a third-person heading, and a refusal once they
// turn sharing off. Runs on two dedicated cookie-less readers — never the
// shared admin, whose `share_stats` flag `account.spec.ts` reads as "on" —
// so flipping one reader's sharing can't ripple into any other file.

import type { APIRequestContext, Page } from "@playwright/test";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { expectNavVisible, gotoReady, waitForHydration } from "../utils/nav";
import { fixturesDir, seedLibrary } from "../utils/seed";
import { logInThroughUi, provisionUser } from "../utils/users";

// The tests walk the two readers' shared state through its states in order.
test.describe.configure({ mode: "serial" });

const VIEWER = "household-viewer";
const TARGET = "household-target";
const PASSWORD = "household-stats-pw-01";
const ACCOUNT = "/settings?section=account";
const NOT_SHARING = "This reader isn't sharing their stats";

const readerTrigger = (page: Page) => page.getByTestId("stats-reader-trigger");

let viewer: Page;
let target: Page;
let targetId: number;
let targetApi: APIRequestContext;

test.beforeAll(async ({ browser, request, playwright, baseURL }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  await provisionUser(request, VIEWER, PASSWORD);
  await provisionUser(request, TARGET, PASSWORD);

  // A bearer session for the target, kept spec-local — the `createShelfAs`
  // shape in shelf_detail.spec.ts. Used to read its own id, reset its own
  // sharing preference, and seed one book's worth of activity, all without
  // touching the shared admin's cookie session.
  targetApi = await playwright.request.newContext({ baseURL });
  const login = await targetApi.post("/api/auth/login", {
    data: { username: TARGET, password: PASSWORD, client_kind: "bearer" },
  });
  expect(login.status(), "bearer login failed for household-target").toBe(200);
  const { token } = (await login.json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };

  const me = (await (
    await targetApi.get("/api/auth/me", { headers: auth })
  ).json()) as { id: number };
  targetId = me.id;

  const shareResp = await targetApi.post("/api/account/share-stats", {
    headers: auth,
    data: { enabled: true },
  });
  expect(shareResp.status(), "resetting the target's sharing on failed").toBe(
    200,
  );

  const uuid = await fetchBookUuidByTitle(request, "Beta in the Series");
  const now = Math.floor(Date.now() / 1000);
  const sessionResp = await targetApi.post("/api/progress/sessions", {
    headers: auth,
    data: [
      {
        book_uuid: uuid,
        format: "epub",
        started_at: now - 60,
        ended_at: now,
        progress_units: 60,
        utc_offset_minutes: 0,
      },
    ],
  });
  expect(
    sessionResp.status(),
    "seeding the target's reading session failed",
  ).toBe(200);
  const sessionBody = (await sessionResp.json()) as { recorded: number };
  expect(sessionBody.recorded, "the seeded session was skipped").toBe(1);

  const positionResp = await targetApi.post("/api/progress", {
    headers: auth,
    data: {
      book_uuid: uuid,
      format: "epub",
      epub_cfi: "epubcfi(/6/4!/4/2/2[c01]/2/1:0)",
    },
  });
  expect(
    positionResp.status(),
    "seeding the target's reading position failed",
  ).toBe(200);

  const viewerContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  viewer = await viewerContext.newPage();
  await logInThroughUi(viewer, VIEWER, PASSWORD);

  const targetContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  target = await targetContext.newPage();
  await logInThroughUi(target, TARGET, PASSWORD);
});

test.afterAll(async () => {
  await viewer.context().close();
  await target.context().close();
  await targetApi.dispose();
});

test("renders the stats page layout with a picker listing the sharing target", async () => {
  await gotoReady(viewer, "/stats");
  await expectNavVisible(viewer);

  await expect(readerTrigger(viewer)).toHaveAttribute(
    "aria-label",
    "Stats for You",
  );
  await expect(viewer.getByTestId("stats-hero-who")).toHaveCount(0);
  await expect(viewer.getByTestId("stats-empty")).toBeVisible();

  // Options live in the DOM while the menu is `hidden` — asserted without
  // opening it (rule 04: a layout test takes no actions).
  const you = viewer.getByTestId("stats-reader-option-you");
  await expect(you).toContainText("You");
  await expect(you.locator(".st-reader-avatar")).toHaveCount(1);

  const targetOption = viewer.getByTestId(`stats-reader-option-${targetId}`);
  await expect(targetOption).toContainText(TARGET);
  await expect(targetOption.locator(".st-reader-avatar")).toHaveCount(1);
});

test("picking the target shows their figures under a third-person heading", async () => {
  await gotoReady(viewer, "/stats");
  await readerTrigger(viewer).click();
  await expect(viewer.getByTestId("stats-reader-menu")).toBeVisible();
  await viewer.getByTestId(`stats-reader-option-${targetId}`).click();

  await expect(viewer).toHaveURL(new RegExp(`/stats\\?user=${targetId}$`));
  await expect(viewer.getByTestId("stats-hero-who")).toHaveText(
    `${TARGET}'s stats`,
  );
  await expect(viewer.getByTestId("stats-empty")).toHaveCount(0);
  await expect(viewer.getByTestId("stats-in-progress")).toContainText(
    "Beta in the Series",
  );
  await expect(viewer.getByTestId("stats-goal-set-link")).toHaveCount(0);
  await expect(viewer.getByTestId("stats-daily-set-link")).toHaveCount(0);

  await expectMutation(
    viewer,
    {
      method: "POST",
      url: "/api/rpc/stats",
      // `utc_offset_minutes` is 0 because the suite pins `timezoneId` to UTC
      // (rule 10); `user_id` follows the route's `?user=`, not the caller.
      expectedBody: {
        range: "year",
        utc_offset_minutes: 0,
        user_id: targetId,
      },
      expectedStatus: 200,
    },
    async () => viewer.getByTestId("stats-range-year").click(),
  );

  // A fresh load of the same URL (not a client-side nav) reads identically —
  // the SSR half of `?user=` has to agree with the hydrated one.
  await gotoReady(viewer, `/stats?user=${targetId}`);
  await expect(viewer.getByTestId("stats-hero-who")).toHaveText(
    `${TARGET}'s stats`,
  );
  await expect(readerTrigger(viewer)).toHaveAttribute(
    "aria-label",
    `Stats for ${TARGET}`,
  );

  // Library scope still works while viewing another reader.
  await viewer.getByTestId("stats-scope-tab-library").click();
  await expect(viewer.getByTestId("stats-scope-library")).toBeVisible();

  // Choosing "You" returns to the caller's own page.
  await viewer.getByTestId("stats-scope-tab-user").click();
  await readerTrigger(viewer).click();
  await viewer.getByTestId("stats-reader-option-you").click();
  await expect(viewer).toHaveURL(/\/stats$/);
  await expect(viewer.getByTestId("stats-empty")).toBeVisible();
  await expect(viewer.getByTestId("stats-hero-who")).toHaveCount(0);
});

test("a slower fetch for the previous reader can't overwrite the target's in-progress card", async () => {
  // Hold the viewer's own in-progress fetch (user_id null, the page's own
  // limit — not the user-menu's separate limit=1 call) so it resolves after
  // the switch below, and prove the epoch guard drops it as stale.
  let releaseOwnFetch: () => void = () => {};
  const ownFetchHeld = new Promise<void>((resolve) => {
    releaseOwnFetch = resolve;
  });
  await viewer.route("**/api/rpc/progress/recent", async (route) => {
    const body = route.request().postDataJSON() as {
      limit: number;
      user_id: number | null;
    };
    if (body.user_id === null && body.limit === 3) {
      await ownFetchHeld;
    }
    await route.continue();
  });

  // Plain goto, not gotoReady: the held request keeps the page from ever
  // reaching networkidle (rule 04b's pattern for holding a request open).
  await viewer.goto("/stats");
  await waitForHydration(viewer);
  await expect(readerTrigger(viewer)).toHaveAttribute(
    "aria-label",
    "Stats for You",
  );

  await readerTrigger(viewer).click();
  await viewer.getByTestId(`stats-reader-option-${targetId}`).click();
  await expect(viewer.getByTestId("stats-hero-who")).toHaveText(
    `${TARGET}'s stats`,
  );
  await expect(viewer.getByTestId("stats-in-progress")).toContainText(
    "Beta in the Series",
  );

  const stalePromise = viewer.waitForResponse(
    (resp) =>
      resp.url().includes("/api/rpc/progress/recent") &&
      (resp.request().postDataJSON() as { user_id: number | null }).user_id ===
        null,
  );
  releaseOwnFetch();
  await stalePromise;

  await expect(viewer.getByTestId("stats-in-progress")).toContainText(
    "Beta in the Series",
  );

  await viewer.unroute("**/api/rpc/progress/recent");
  await readerTrigger(viewer).click();
  await viewer.getByTestId("stats-reader-option-you").click();
  await expect(viewer).toHaveURL(/\/stats$/);
});

test("a failed reader-list fetch still renders the hero, without a picker", async () => {
  await viewer.route("**/api/rpc/household-readers", (route) =>
    route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "forced failure",
    }),
  );
  await gotoReady(viewer, "/stats");
  await expect(viewer.getByTestId("stats-hero")).toBeVisible();
  await expect(viewer.getByTestId("stats-reader-picker")).toHaveCount(0);
  await viewer.unroute("**/api/rpc/household-readers");
});

test("turning sharing off drops the target from the picker and refuses a direct link", async () => {
  await gotoReady(target, ACCOUNT);
  const shareSwitch = target.getByRole("switch", {
    name: "Share stats with household",
  });
  await expect(shareSwitch).toBeChecked();
  await expectMutation(
    target,
    {
      method: "POST",
      url: "/api/rpc/account/share-stats",
      expectedBody: { enabled: false },
      expectedStatus: 200,
    },
    async () => shareSwitch.click(),
  );

  // Options live in the DOM even while the menu is closed, so this doesn't
  // need to open it first.
  await gotoReady(viewer, "/stats");
  await expect(
    viewer.getByTestId(`stats-reader-option-${targetId}`),
  ).toHaveCount(0);

  await gotoReady(viewer, `/stats?user=${targetId}`);
  await expect(viewer.getByRole("alert")).toHaveText(NOT_SHARING);
  await viewer.getByRole("link", { name: "Back to your stats" }).click();
  await expect(viewer).toHaveURL(/\/stats$/);

  // An id naming no reader at all gets the same refusal, not a crash.
  await gotoReady(viewer, "/stats?user=2147483647");
  await expect(viewer.getByRole("alert")).toHaveText(NOT_SHARING);
});

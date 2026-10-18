import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  APIRequest,
  APIRequestContext,
  APIResponse,
  Browser,
  Page,
  ViewportSize,
  WorkerInfo,
} from "@playwright/test";
import { STORAGE_STATE_PATH } from "../../globalSetup";
import { AccountRequests } from "../apiRequests/AccountRequests";
import { AuthRequests } from "../apiRequests/AuthRequests";
import { LogViewerRequests } from "../apiRequests/LogViewerRequests";
import { ProgressRequests } from "../apiRequests/ProgressRequests";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { StatsRequests } from "../apiRequests/StatsRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
import type {
  CreatedApiToken,
  CreatedKoboDevice,
  SignedInSession,
} from "../data/account";
import {
  buildSession,
  TARGET_BOOK_CFI,
  TARGET_BOOK_TITLE,
} from "../data/stats";
import { buildReader, type Credentials, type SeededUser } from "../data/users";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { withLock } from "../utils/lock";
import { cleanupSet, type Owner, presetting } from "./lifecycle";
import { test as base, expect } from "./requestFixtures";
import { loadAdminBearerToken, newBearerContext } from "./test";

/** A plain reader this worker signs up once, for every test that needs one. */
export type ReaderAccount = Credentials & {
  id: number;
  storageStatePath: string;
  bearerToken: string;
};

/** Retries a sign-in the limiter answered 429 until it clears, for up to 70 s. */
async function signInPastLimit(
  attempt: () => Promise<APIResponse>,
): Promise<APIResponse> {
  let response = await attempt();
  await expect
    .poll(
      async () => {
        if (response.status() === 429) response = await attempt();
        return response.status();
      },
      {
        message: "sign-in stays rate limited",
        timeout: 70_000,
        intervals: [1_000, 5_000],
      },
    )
    .not.toBe(429);
  return response;
}

/** Signs up a reader and signs it in for a cookie and a bearer; deletes it after `use`. */
async function withReaderAccount(
  api: APIRequest,
  workerInfo: WorkerInfo,
  use: (account: ReaderAccount) => Promise<void>,
): Promise<void> {
  const options = workerInfo.project.use;
  const admin = await newBearerContext(api, options, loadAdminBearerToken());
  const users = new UsersRequests(admin);
  const reader = buildReader();
  const created = await users.postUser(reader);
  await expect(created, `create ${reader.username}`).toBeOK();
  const { id } = await created.json();

  const session = await newBearerContext(api, options, null);
  const auth = new AuthRequests(session);
  await expect(
    await signInPastLimit(() => auth.postCookieLogin(reader)),
  ).toBeOK();
  const storageStatePath = join(
    workerInfo.project.outputDir,
    ".auth",
    `${reader.username}.json`,
  );
  await session.storageState({ path: storageStatePath });
  const bearer = await signInPastLimit(() => auth.postBearerLogin(reader));
  await expect(bearer).toBeOK();
  const { token } = await bearer.json();
  await session.dispose();

  await use({ ...reader, id, storageStatePath, bearerToken: token });

  await expect(await users.deleteUser(id)).toBeOK();
  await admin.dispose();
}

/** A page in a context of its own signed in as `account`, closed after `use`. */
async function usePageAs(
  browser: Browser,
  account: ReaderAccount,
  viewport: ViewportSize | null,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    storageState: account.storageStatePath,
    viewport,
  });
  await use(await context.newPage());
  await context.close();
}

type AccountWorkerFixtures = {
  readerAccount: ReaderAccount;
  secondReaderAccount: ReaderAccount;
};

type AccountFixtures = {
  readerPage: Page;
  readerRequest: APIRequestContext;
  readerShelvesRequests: ShelvesRequests;
  readerAccountRequests: AccountRequests;
  readerScanRequests: ScanRequests;
  accountFor: (owner: Owner) => AccountRequests;
  secondReaderPage: Page;
  secondReaderRequest: APIRequestContext;
  adminSession: SignedInSession;
  presetGoals: (goals?: { books?: number; pages?: number }) => Promise<void>;
  presetShareStats: (enabled: boolean) => Promise<void>;
  presetDisplayName: (displayName: string | null) => Promise<void>;
  presetKindleEmail: (email: string | null) => Promise<void>;
  presetMcpEndpoint: (enabled: boolean) => Promise<void>;
  presetHiddenFormats: (formats: string[], owner?: Owner) => Promise<void>;
  createdKoboDeviceIds: Set<number>;
  ownKoboDevice: (name: string) => Promise<number>;
  createdApiTokenIds: Set<number>;
  ownApiToken: (name: string) => Promise<number>;
  createdUserIds: Set<number>;
  seedUser: () => Promise<SeededUser>;
  anonymousRequest: APIRequestContext;
  anonymousLogViewerRequests: LogViewerRequests;
  presetScrollStops: (enabled: boolean, owner?: Owner) => Promise<void>;
  presetStackSeries: (enabled: boolean, owner?: Owner) => Promise<void>;
  householdTarget: ReaderAccount;
};

/**
 * The accounts a spec can act as: the worker's reader and a second reader (with
 * their pages and API contexts), the signed-out context, and the preferences
 * and records a test changes on those accounts, which each fixture puts back.
 */
export const test = base.extend<AccountFixtures, AccountWorkerFixtures>({
  // One account per worker rather than per test, because sign-in allows ten
  // calls a minute per IP and a worker runs its tests one at a time.
  readerAccount: [
    async ({ playwright }, use, workerInfo) =>
      withReaderAccount(playwright.request, workerInfo, use),
    { scope: "worker", timeout: 120_000 },
  ],

  secondReaderAccount: [
    async ({ playwright }, use, workerInfo) =>
      withReaderAccount(playwright.request, workerInfo, use),
    { scope: "worker", timeout: 120_000 },
  ],

  readerPage: async ({ browser, readerAccount, viewport }, use) => {
    await usePageAs(browser, readerAccount, viewport, use);
  },

  readerRequest: async (
    { playwright, baseURL, extraHTTPHeaders, readerAccount },
    use,
  ) => {
    const context = await newBearerContext(
      playwright.request,
      { baseURL, extraHTTPHeaders },
      readerAccount.bearerToken,
    );
    await use(context);
    await context.dispose();
  },

  readerShelvesRequests: async ({ readerRequest }, use) => {
    await use(new ShelvesRequests(readerRequest));
  },

  readerAccountRequests: async ({ readerRequest }, use) => {
    await use(new AccountRequests(readerRequest));
  },

  readerScanRequests: async ({ readerRequest }, use) => {
    await use(new ScanRequests(readerRequest));
  },

  // The one place an owner picks whose account a preset writes to.
  accountFor: async ({ accountRequests, readerAccountRequests }, use) => {
    await use((owner) =>
      owner === "admin" ? accountRequests : readerAccountRequests,
    );
  },

  secondReaderPage: async ({ browser, secondReaderAccount, viewport }, use) => {
    await usePageAs(browser, secondReaderAccount, viewport, use);
  },

  secondReaderRequest: async (
    { playwright, baseURL, extraHTTPHeaders, secondReaderAccount },
    use,
  ) => {
    const context = await newBearerContext(
      playwright.request,
      { baseURL, extraHTTPHeaders },
      secondReaderAccount.bearerToken,
    );
    await use(context);
    await context.dispose();
  },

  adminSession: async ({ request }, use) => {
    const me = await new AuthRequests(request).getMe();
    await expect(me).toBeOK();
    const stored: { cookies: SignedInSession["cookies"] } = JSON.parse(
      readFileSync(STORAGE_STATE_PATH, "utf8"),
    );
    await use({ user: await me.json(), cookies: stored.cookies });
  },

  // The goal fixtures start from no goals and end there, because a stats spec
  // writes the same three rows on this admin.
  presetGoals: async ({ goalsRequests }, use) => {
    const clear = async () => {
      for (const cleared of await goalsRequests.clearAll()) {
        await expect(cleared, "clear the reading goals").toBeOK();
      }
    };
    await use(async ({ books, pages } = {}) => {
      await clear();
      if (books !== undefined) {
        const set = await goalsRequests.putAnnualGoal({ target: books });
        await expect(set, `set the annual goal to ${books}`).toBeOK();
      }
      if (pages !== undefined) {
        const set = await goalsRequests.putDailyGoals({
          kind: "pages",
          target: pages,
        });
        await expect(set, `set the daily pages goal to ${pages}`).toBeOK();
      }
    });
    await clear();
  },

  // Sharing is on for every other spec, so that is where a test leaves it.
  presetShareStats: async ({ accountRequests }, use) =>
    presetting(use, {
      write: (enabled: boolean) => accountRequests.postShareStats(enabled),
      reset: true,
      label: (enabled) => `set share stats to ${enabled}`,
    }),

  presetDisplayName: async ({ accountRequests }, use) =>
    presetting(use, {
      write: (displayName: string | null) =>
        accountRequests.postProfile(displayName),
      reset: null,
      label: (displayName) => `set the display name to ${displayName}`,
    }),

  presetKindleEmail: async ({ accountRequests }, use) =>
    presetting(use, {
      write: (email: string | null) => accountRequests.postKindleEmail(email),
      reset: null,
      label: (email) => `set the Kindle email to ${email}`,
    }),

  // The switch is instance-wide and a reader takes no lock, so the lock keeps
  // two writers from flipping it under each other.
  presetMcpEndpoint: async ({ mcpRequests }, use) =>
    withLock("mcp-endpoint", () =>
      presetting(use, {
        write: (enabled: boolean) => mcpRequests.postMcp(enabled),
        reset: false,
        label: (enabled) => `set the MCP endpoint to ${enabled}`,
      }),
    ),

  presetHiddenFormats: async ({ accountFor }, use) =>
    presetting(use, {
      write: (formats: string[], owner: Owner) =>
        accountFor(owner).postHiddenFormats(formats),
      reset: [],
      label: (formats) => `hide formats [${formats}]`,
    }),

  createdKoboDeviceIds: async ({ accountRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => accountRequests.postKoboDeviceRevoke(id),
      (id) => `revoke Kobo device ${id}`,
    ),

  ownKoboDevice: async ({ accountRequests, createdKoboDeviceIds }, use) => {
    await use(async (name) => {
      const created = await accountRequests.postKoboDevice(name);
      await expect(created, `add Kobo device ${name}`).toBeOK();
      const { id }: CreatedKoboDevice = await created.json();
      createdKoboDeviceIds.add(id);
      return id;
    });
  },

  createdApiTokenIds: async ({ accountRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => accountRequests.postApiTokenRevoke(id),
      (id) => `revoke API token ${id}`,
    ),

  ownApiToken: async ({ accountRequests, createdApiTokenIds }, use) => {
    await use(async (name) => {
      const created = await accountRequests.postApiToken(name);
      await expect(created, `create API token ${name}`).toBeOK();
      const { token }: CreatedApiToken = await created.json();
      createdApiTokenIds.add(token.id);
      return token.id;
    });
  },

  createdUserIds: async ({ usersRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => usersRequests.deleteUser(id),
      (id) => `delete user ${id}`,
    ),

  seedUser: async ({ usersRequests, createdUserIds }, use) => {
    await use(async () => {
      const user = buildReader();
      const created = await usersRequests.postUser(user);
      await expect(created, `create ${user.username}`).toBeOK();
      const { id } = await created.json();
      createdUserIds.add(id);
      return { ...user, id };
    });
  },

  anonymousRequest: async ({ playwright, baseURL, extraHTTPHeaders }, use) => {
    const context = await newBearerContext(
      playwright.request,
      { baseURL, extraHTTPHeaders },
      null,
    );
    await use(context);
    await context.dispose();
  },

  anonymousLogViewerRequests: async ({ anonymousRequest }, use) => {
    await use(new LogViewerRequests(anonymousRequest));
  },

  // Turns the switch back off for whoever it touched, because every other
  // detail test reads the flow.
  presetScrollStops: async ({ accountFor }, use) =>
    presetting(use, {
      write: (enabled: boolean, owner: Owner) =>
        accountFor(owner).postScrollStops(enabled),
      reset: false,
      label: (enabled) => `set scroll stops to ${enabled}`,
    }),

  // The preference outlives the test, so it goes back to off after.
  presetStackSeries: async ({ accountFor }, use) =>
    presetting(use, {
      write: (enabled: boolean, owner: Owner) =>
        accountFor(owner).postStackSeries(enabled),
      reset: false,
      label: (enabled) => `save stack series ${enabled}`,
    }),

  // Sharing is visible to every reader on the instance, so it goes back off
  // after each test; the library must be seeded before this runs.
  householdTarget: async (
    { request, secondReaderAccount, secondReaderRequest },
    use,
  ) => {
    const account = new AccountRequests(secondReaderRequest);
    const stats = new StatsRequests(secondReaderRequest);
    const progress = new ProgressRequests(secondReaderRequest);
    const bookUuid = await fetchBookUuidByTitle(request, TARGET_BOOK_TITLE);
    const now = Math.floor(Date.now() / 1000);
    const sitting = await stats.postSessions([
      buildSession(bookUuid, {
        startedAt: now - 60,
        seconds: 60,
        format: "epub",
        utcOffsetMinutes: 0,
      }),
    ]);
    await expect(sitting, "seed the target's reading session").toBeOK();
    const { recorded } = await sitting.json();
    expect(recorded, "the target's session was skipped").toBe(1);
    const placed = await progress.postEpubPosition(bookUuid, TARGET_BOOK_CFI);
    await expect(placed, "seed the target's reading position").toBeOK();

    // Last, so no reader sees the target shared before its records exist.
    await expect(
      await account.postShareStats(true),
      "turn the target's sharing on",
    ).toBeOK();

    await use(secondReaderAccount);

    await expect(
      await account.postShareStats(false),
      "turn the target's sharing off",
    ).toBeOK();
  },
});

export { expect };

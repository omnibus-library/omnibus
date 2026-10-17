import { join } from "node:path";
import type { Request, Response } from "@playwright/test";
import { AuthRequests } from "../apiRequests/AuthRequests";
import { PhysicalRequests } from "../apiRequests/PhysicalRequests";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
import type { FiledCopy, PhysicalCopy } from "../data/physical";
import { type ShelfRef, wishlistOf } from "../data/shelves";
import { buildReader, type Credentials } from "../data/users";
import { BookDetailPage } from "../pages/BookDetailPage";
import { CheckInPage } from "../pages/CheckInPage";
import { EpubReaderPage } from "../pages/EpubReaderPage";
import { LibraryPage } from "../pages/LibraryPage";
import { ShelfPage } from "../pages/ShelfPage";
import {
  type ExpectMutationOptions,
  expectMutation as expectMutationOn,
} from "../utils/api";
import {
  test as base,
  expect,
  loadAdminBearerToken,
  newBearerContext,
} from "./test";

/** `expectMutation` from `utils/api`, bound to the test's page. */
export type ExpectMutation = <T>(
  contract: ExpectMutationOptions,
  action: () => Promise<T>,
) => Promise<{ result: T; request: Request; response: Response }>;

/** A plain reader this worker signs up once, for every test that needs one. */
export type ReaderAccount = Credentials & {
  id: number;
  storageStatePath: string;
  bearerToken: string;
};

type PageWorkerFixtures = {
  readerAccount: ReaderAccount;
};

type PageFixtures = {
  expectMutation: ExpectMutation;
  libraryPage: LibraryPage;
  bookDetailPage: BookDetailPage;
  checkInPage: CheckInPage;
  epubReaderPage: EpubReaderPage;
  shelfPage: ShelfPage;
  scanRequests: ScanRequests;
  physicalRequests: PhysicalRequests;
  createdBookUuids: Set<string>;
  filedCopies: FiledCopy[];
  adminWishlist: ShelfRef;
  readerShelfPage: ShelfPage;
};

/**
 * The suite admin's page and its page objects. Also the admin's API calls,
 * the cleanup for what a test adds, and the worker's reader in a browser
 * context of their own. `readerFixtures.ts` signs the page in as that reader.
 */
export const test = base.extend<PageFixtures, PageWorkerFixtures>({
  // One account per worker rather than per test, because sign-in allows ten
  // calls a minute per IP and a worker runs its tests one at a time.
  readerAccount: [
    async ({ playwright }, use, workerInfo) => {
      const options = workerInfo.project.use;
      const admin = await newBearerContext(
        playwright.request,
        options,
        loadAdminBearerToken(),
      );
      const users = new UsersRequests(admin);
      const reader = buildReader();
      const created = await users.postUser(reader);
      await expect(created, `create ${reader.username}`).toBeOK();
      const { id } = await created.json();

      const session = await newBearerContext(playwright.request, options, null);
      const auth = new AuthRequests(session);
      await expect(await auth.postCookieLogin(reader)).toBeOK();
      const storageStatePath = join(
        workerInfo.project.outputDir,
        ".auth",
        `${reader.username}.json`,
      );
      await session.storageState({ path: storageStatePath });
      const bearer = await auth.postBearerLogin(reader);
      await expect(bearer).toBeOK();
      const { token } = await bearer.json();
      await session.dispose();

      await use({ ...reader, id, storageStatePath, bearerToken: token });

      await expect(await users.deleteUser(id)).toBeOK();
      await admin.dispose();
    },
    { scope: "worker" },
  ],

  expectMutation: async ({ page }, use) => {
    await use((contract, action) => expectMutationOn(page, contract, action));
  },
  libraryPage: async ({ page }, use) => {
    await use(new LibraryPage(page));
  },
  bookDetailPage: async ({ page }, use) => {
    await use(new BookDetailPage(page));
  },
  checkInPage: async ({ page }, use) => {
    await use(new CheckInPage(page));
  },
  epubReaderPage: async ({ page }, use) => {
    await use(new EpubReaderPage(page));
  },
  shelfPage: async ({ page }, use) => {
    await use(new ShelfPage(page));
  },

  scanRequests: async ({ request }, use) => {
    await use(new ScanRequests(request));
  },

  physicalRequests: async ({ request }, use) => {
    await use(new PhysicalRequests(request));
  },

  createdBookUuids: async ({ physicalRequests }, use) => {
    const uuids = new Set<string>();
    await use(uuids);
    for (const uuid of uuids) {
      const deleted = await physicalRequests.deleteBook(uuid);
      await expect(deleted, `delete ${uuid}`).toBeOK();
    }
  },

  filedCopies: async ({ physicalRequests }, use) => {
    const filed: FiledCopy[] = [];
    await use(filed);
    for (const { bookUuid, note } of filed) {
      const listed = await physicalRequests.getCopies(bookUuid);
      await expect(listed).toBeOK();
      const copies: PhysicalCopy[] = await listed.json();
      for (const copy of copies.filter((copy) => copy.note === note)) {
        const deleted = await physicalRequests.deleteCopy(copy.id);
        await expect(deleted, `delete copy ${copy.id}`).toBeOK();
      }
    }
  },

  adminWishlist: async ({ request }, use) => {
    const me = await new AuthRequests(request).getMe();
    await expect(me).toBeOK();
    const { id } = await me.json();
    const listed = await new ShelvesRequests(request).getShelves();
    await expect(listed).toBeOK();
    await use(wishlistOf(await listed.json(), id));
  },

  readerShelfPage: async ({ browser, readerAccount }, use) => {
    const context = await browser.newContext({
      storageState: readerAccount.storageStatePath,
    });
    await use(new ShelfPage(await context.newPage()));
    await context.close();
  },
});

export { expect };

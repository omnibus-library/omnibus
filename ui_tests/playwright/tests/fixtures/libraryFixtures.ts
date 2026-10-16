import { join } from "node:path";
import { AuthRequests } from "../apiRequests/AuthRequests";
import { PhysicalRequests } from "../apiRequests/PhysicalRequests";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
import type { FiledCopy, PhysicalCopy } from "../data/physical";
import type { Shelf, ShelfRef } from "../data/shelves";
import { buildReader, type Credentials } from "../data/users";
import { ShelfPage } from "../pages/ShelfPage";
import { test as base, expect } from "./pageFixtures";
import { loadAdminBearerToken, newBearerContext } from "./test";

/** A plain reader this worker signs up once, for every test that needs one. */
export type ReaderAccount = Credentials & {
  id: number;
  storageStatePath: string;
  bearerToken: string;
};

type LibraryWorkerFixtures = {
  readerAccount: ReaderAccount;
};

type LibraryFixtures = {
  scanRequests: ScanRequests;
  physicalRequests: PhysicalRequests;
  createdBookUuids: string[];
  filedCopies: FiledCopy[];
  adminWishlist: ShelfRef;
  readerShelfPage: ShelfPage;
};

/**
 * The suite admin's API calls into the shared library, the cleanup for what
 * a test adds to it, and the worker's reader in a browser of their own. The
 * test's page stays the admin's; `readerFixtures.ts` signs it in as the reader.
 */
export const test = base.extend<LibraryFixtures, LibraryWorkerFixtures>({
  // One account per worker rather than per test: sign-in allows ten calls a
  // minute per IP, and a worker runs its tests one at a time.
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

  scanRequests: async ({ request }, use) => {
    await use(new ScanRequests(request));
  },

  physicalRequests: async ({ request }, use) => {
    await use(new PhysicalRequests(request));
  },

  createdBookUuids: async ({ physicalRequests }, use) => {
    const uuids: string[] = [];
    await use(uuids);
    for (const uuid of uuids) {
      const deleted = await physicalRequests.deleteBook(uuid);
      if (deleted.ok()) continue;
      // The last-copy prompt deletes a book itself, ahead of this teardown.
      expect(await deleted.json(), `delete ${uuid}`).toMatchObject({
        message: "book not found",
      });
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
    const shelves: Shelf[] = await listed.json();
    const wishlist = shelves.find(
      (shelf) => shelf.kind === "wishlist" && shelf.owner_user_id === id,
    );
    if (!wishlist) throw new Error("the suite admin has no Wishlist shelf");
    await use({ id: wishlist.id, name: wishlist.name });
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

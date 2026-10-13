import { join } from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { AuthRequests } from "../apiRequests/AuthRequests";
import { PhysicalRequests } from "../apiRequests/PhysicalRequests";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
import type { ExternalBookMeta, Wish } from "../data/scan";
import type { Shelf } from "../data/shelves";
import { buildReader, type Credentials } from "../data/users";
import { test as base, expect } from "./pageFixtures";
import { loadAdminBearerToken, newBearerContext } from "./test";

/** A plain reader this worker signs up once and every test signs in as. */
export type ReaderAccount = Credentials & {
  id: number;
  storageStatePath: string;
  bearerToken: string;
};

type ReaderWorkerFixtures = {
  readerAccount: ReaderAccount;
};

type ReaderFixtures = {
  readerRequest: APIRequestContext;
  readerScanRequests: ScanRequests;
  readerShelvesRequests: ShelvesRequests;
  physicalRequests: PhysicalRequests;
  createdBookUuids: string[];
  wishFor: (book: ExternalBookMeta) => Promise<Wish>;
};

export const test = base.extend<ReaderFixtures, ReaderWorkerFixtures>({
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

  storageState: async ({ readerAccount }, use) => {
    await use(readerAccount.storageStatePath);
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

  readerScanRequests: async ({ readerRequest }, use) => {
    await use(new ScanRequests(readerRequest));
  },

  readerShelvesRequests: async ({ readerRequest }, use) => {
    await use(new ShelvesRequests(readerRequest));
  },

  physicalRequests: async ({ request }, use) => {
    await use(new PhysicalRequests(request));
  },

  createdBookUuids: async ({ physicalRequests }, use) => {
    const uuids: string[] = [];
    await use(uuids);
    for (const uuid of uuids) {
      const deleted = await physicalRequests.deleteBook(uuid);
      await expect(deleted, `delete ${uuid}`).toBeOK();
    }
  },

  wishFor: async (
    {
      readerAccount,
      readerScanRequests,
      readerShelvesRequests,
      createdBookUuids,
    },
    use,
  ) => {
    await use(async (book) => {
      const added = await readerScanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      const { book_uuid: uuid } = await added.json();
      createdBookUuids.push(uuid);

      const listed = await readerShelvesRequests.getShelves();
      await expect(listed).toBeOK();
      const shelves: Shelf[] = await listed.json();
      const wishlist = shelves.find(
        (shelf) =>
          shelf.kind === "wishlist" && shelf.owner_user_id === readerAccount.id,
      );
      if (!wishlist) {
        throw new Error(`${readerAccount.username} has no Wishlist shelf`);
      }
      return { ...book, uuid, shelf: { id: wishlist.id, name: wishlist.name } };
    });
  },
});

export { expect };

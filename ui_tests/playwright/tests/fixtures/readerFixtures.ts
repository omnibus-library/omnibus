import type { ExternalBookMeta, Wish } from "../data/scan";
import { wishlistOf } from "../data/shelves";
import { test as base, expect } from "./pageFixtures";

type ReaderFixtures = {
  wishFor: (book: ExternalBookMeta) => Promise<Wish>;
};

/** Signs the test's page in as the worker's reader. */
export const test = base.extend<ReaderFixtures>({
  storageState: async ({ readerAccount }, use) => {
    await use(readerAccount.storageStatePath);
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
      createdBookUuids.add(uuid);

      const listed = await readerShelvesRequests.getShelves();
      await expect(listed).toBeOK();
      const shelf = wishlistOf(await listed.json(), readerAccount.id);
      return { ...book, uuid, shelf };
    });
  },
});

export { expect };

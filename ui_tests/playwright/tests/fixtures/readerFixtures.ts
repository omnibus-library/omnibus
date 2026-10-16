import type { APIRequestContext } from "@playwright/test";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import type { ExternalBookMeta, Wish } from "../data/scan";
import { wishlistOf } from "../data/shelves";
import { test as base, expect } from "./pageFixtures";
import { newBearerContext } from "./test";

type ReaderFixtures = {
  readerRequest: APIRequestContext;
  readerScanRequests: ScanRequests;
  readerShelvesRequests: ShelvesRequests;
  wishFor: (book: ExternalBookMeta) => Promise<Wish>;
};

/** Signs the test's page in as the worker's reader. */
export const test = base.extend<ReaderFixtures>({
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

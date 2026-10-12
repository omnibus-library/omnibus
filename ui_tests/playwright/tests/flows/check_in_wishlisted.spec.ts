import { scan } from "../contracts/scan";
import type { PhysicalCopy } from "../data/physical";
import {
  buildExternalBook,
  inLibraryUnowned,
  notInLibrary,
} from "../data/scan";
import type { Shelf } from "../data/shelves";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/readerFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

test.describe("wishlist check-in", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("check in a wishlisted book from its own page", async ({
    readerAccount,
    bookDetailPage,
    wishFor,
    physicalRequests,
    readerShelvesRequests,
    expectMutation,
  }) => {
    const wish = await wishFor(buildExternalBook());
    const overlay = bookDetailPage.checkInOverlay;

    await test.step("open the wished-for book", async () => {
      await bookDetailPage.goto(wish.uuid);
      await expect(bookDetailPage.fromSameHandEmptyMessage).toContainText(
        "0 books in your library",
      );
    });

    await test.step("open check-in with the isbn prefilled", async () => {
      await bookDetailPage.checkInWhenAcquired();
      await expect(overlay.root).toBeVisible();
      await expect(overlay.isbnField).toHaveValue(wish.isbn13);
    });

    await test.step("find the wishlist entry", async () => {
      await expectMutation(scan.resolve(), () => overlay.findBook());
      await expect(overlay.confirmScreen).toContainText("on your wishlist");
      await expect(overlay.bookCard).toContainText(wish.title);
    });

    await test.step("check in the copy", async () => {
      await expectMutation(scan.checkIn(wish), () => overlay.checkInCopy());
      await expect(overlay.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(overlay.successScreen).toContainText(wish.title);
      await expect(overlay.offWishlistMessage).toContainText(
        "off your wishlist",
      );
    });

    await test.step("check the copy is filed by the reader", async () => {
      const response = await physicalRequests.getCopies(wish.uuid);
      await expect(response).toBeOK();
      const copies: PhysicalCopy[] = await response.json();
      expect(copies.map((copy) => copy.added_by_name)).toEqual([
        readerAccount.username,
      ]);
    });

    await test.step("check the wishlist is empty", async () => {
      const response = await readerShelvesRequests.getShelves();
      await expect(response).toBeOK();
      const shelves: Shelf[] = await response.json();
      const wishlist = shelves.find((shelf) => shelf.id === wish.shelf.id);
      expect(wishlist?.book_count).toBe(0);
    });

    await test.step("check the book page follows the check-in", async () => {
      await overlay.close();
      await expect(bookDetailPage.physicalCopyCards).toHaveCount(1);
      await expect(bookDetailPage.physicalCopyCards).toContainText("by you");
      await expect(bookDetailPage.checkInWhenAcquiredButton).toHaveCount(0);
      await expect(bookDetailPage.fromSameHandEmptyMessage).toContainText(
        "1 book in your library",
      );
    });
  });

  test("check in a second copy of a filed book", async ({
    bookDetailPage,
    wishFor,
    readerScanRequests,
    expectMutation,
  }) => {
    const wish = await wishFor(buildExternalBook());
    const overlay = bookDetailPage.checkInOverlay;

    await test.step("file the first copy through the api", async () => {
      await expect(await readerScanRequests.postCheckIn(wish)).toBeOK();
    });

    await test.step("open the book with one copy filed", async () => {
      await bookDetailPage.goto(wish.uuid);
      await expect(bookDetailPage.physicalCopyCards).toHaveCount(1);
    });

    await test.step("check in a second copy from the top nav", async () => {
      // A filed book resolves as already owned, which navigates, not confirms.
      await overlay.stubIsbnLookup(inLibraryUnowned(wish));
      await bookDetailPage.topNav.openCheckIn();
      await overlay.enterIsbn(wish.isbn13);
      await expectMutation(scan.resolve(), () => overlay.findBook());
      await expectMutation(scan.checkIn(wish), () => overlay.checkInCopy());
      await overlay.close();
    });

    await test.step("check the second copy lands on the page", async () => {
      await expect(bookDetailPage.physicalCopyCards).toHaveCount(2);
    });
  });

  test("add a book to the wishlist while its shelf is selected", async ({
    libraryPage,
    wishFor,
    createdBookUuids,
    expectMutation,
  }) => {
    const wish = await wishFor(buildExternalBook());
    const added = buildExternalBook();
    const overlay = libraryPage.checkInOverlay;

    await test.step("select the wishlist shelf", async () => {
      await libraryPage.goto();
      await libraryPage.selectShelf(wish.shelf);
      await expect(libraryPage.galleryShelfTile(wish.shelf.id)).toContainText(
        "1 book",
      );
    });

    await test.step("add a book to the wishlist from check-in", async () => {
      // The providers would answer this lookup; the wishlist write is real.
      await overlay.stubIsbnLookup(notInLibrary(added));
      await libraryPage.topNav.openCheckIn();
      await overlay.enterIsbn(added.isbn13);
      await expectMutation(scan.resolve(), () => overlay.findBook());
      const { result } = await expectMutation(scan.wishlist(), () =>
        overlay.addToWishlist(),
      );
      createdBookUuids.push(result.book_uuid);
      await expect(overlay.successScreen).toContainText(added.title);
      await overlay.close();
    });

    await test.step("check the selected shelf follows the add", async () => {
      await expect(libraryPage.galleryShelfTile(wish.shelf.id)).toContainText(
        "2 books",
      );
      await expect(libraryPage.bookTile(added.title)).toBeVisible();
    });
  });
});

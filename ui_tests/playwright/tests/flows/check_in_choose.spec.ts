import { physical } from "../contracts/physical";
import { scan, scanUrls } from "../contracts/scan";
import { type BookRef, buildExternalBook, notInLibrary } from "../data/scan";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/libraryFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The "not in your library" chooser: own it (a fileless book plus its first
// copy) or wish for it (a fileless book on the wishlist). The lookup is
// stubbed, but each write is real: every test mints a book no other spec
// reads, and `createdBookUuids` deletes it afterwards. They run as the suite
// admin, because only an editor may remove a book with its last copy.

test.describe("check-in chooser", () => {
  // A fileless book only lists once a library path is set.
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("add a book not in the library to the collection", async ({
    checkInPage,
    libraryPage,
    bookDetailPage,
    createdBookUuids,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () =>
        checkIn.lookUpIsbn(book.isbn13),
      );
      await expect(checkIn.chooseScreen).toBeVisible();
    });

    const uuid = await test.step("add it to the collection", async () => {
      const { response } = await expectMutation(scan.physicalOnly(), () =>
        checkIn.addToCollection(),
      );
      const added: BookRef = await response.json();
      createdBookUuids.push(added.book_uuid);
      await expect(checkIn.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(checkIn.successScreen).toContainText(book.title);
      return added.book_uuid;
    });

    // A fileless book with a copy is visible to everyone.
    await test.step("check it lists in all books", async () => {
      await libraryPage.goto();
      await expect(libraryPage.bookTile(book.title)).toBeVisible();
    });

    await test.step("check its page shows the copy", async () => {
      await bookDetailPage.goto(uuid);
      await expect(bookDetailPage.titleHeading).toHaveText(book.title);
      await expect(bookDetailPage.physicalPill).toBeVisible();
    });
  });

  test("remove the only copy of a book with no files", async ({
    scanRequests,
    libraryPage,
    bookDetailPage,
    createdBookUuids,
    expectMutation,
  }) => {
    const book = buildExternalBook();

    const uuid = await test.step("add the book through the api", async () => {
      const added = await scanRequests.postPhysicalOnly(book);
      await expect(added).toBeOK();
      const { book_uuid }: BookRef = await added.json();
      createdBookUuids.push(book_uuid);
      return book_uuid;
    });

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
      await expect(bookDetailPage.physicalPill).toBeVisible();
    });

    // The copy goes, then the book it leaves empty, so both waits are armed
    // before the first click.
    await test.step("delete the copy and the book with it", async () => {
      await expectMutation(physical.deleteCopy(), () =>
        expectMutation(physical.deleteBook(uuid), async () => {
          await bookDetailPage.deleteCopy();
          await expect(bookDetailPage.lastCopyDialog).toBeVisible();
          await bookDetailPage.removeFromLibrary();
        }),
      );
    });

    await test.step("check it left all books", async () => {
      await libraryPage.goto();
      await expect(libraryPage.bookTile(book.title)).toHaveCount(0);
    });
  });

  test("add a book not in the library to the wishlist", async ({
    checkInPage,
    libraryPage,
    adminWishlist,
    createdBookUuids,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () =>
        checkIn.lookUpIsbn(book.isbn13),
      );
      await expect(checkIn.chooseScreen).toBeVisible();
    });

    await test.step("add it to the wishlist", async () => {
      const { response } = await expectMutation(scan.wishlist(), () =>
        checkIn.addToWishlist(),
      );
      const added: BookRef = await response.json();
      createdBookUuids.push(added.book_uuid);
      await expect(checkIn.successScreen).toContainText("On your wishlist");
      await expect(checkIn.successScreen).toContainText(book.title);
    });

    await test.step("check the wishlist shelf lists it", async () => {
      await libraryPage.goto();
      await libraryPage.selectShelf(adminWishlist);
      await expect(libraryPage.bookTile(book.title)).toBeVisible();
    });
  });

  // Public by design (`provision_wishlist_shelf`), but kept off other readers'
  // library row, so they reach it through the shelves index.
  test("show the wishlist to another reader", async ({
    scanRequests,
    adminWishlist,
    readerShelfPage,
    createdBookUuids,
  }) => {
    const book = buildExternalBook();

    await test.step("wish for a book through the api", async () => {
      const added = await scanRequests.postWishlistEntry(book);
      await expect(added).toBeOK();
      const { book_uuid }: BookRef = await added.json();
      createdBookUuids.push(book_uuid);
    });

    await test.step("open the wishlist as a plain reader", async () => {
      await readerShelfPage.goto(adminWishlist.id);
    });

    await test.step("check the book is on it", async () => {
      await expect(readerShelfPage.bookTile(book.title)).toBeVisible();
    });
  });

  test("stay on the chooser when adding to the collection fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () =>
        checkIn.lookUpIsbn(book.isbn13),
      );
      await expect(checkIn.chooseScreen).toBeVisible();
    });

    await test.step("add it while adds fail", async () => {
      await checkIn.forceServerError(scanUrls.physicalOnly);
      await expectMutation(failing(scan.physicalOnly()), () =>
        checkIn.addToCollection(),
      );
    });

    await test.step("check the error shows over the chooser", async () => {
      await expect(checkIn.errorMessage).toBeVisible();
      await expect(checkIn.chooseScreen).toBeVisible();
    });
  });

  test("stay on the chooser when adding to the wishlist fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () =>
        checkIn.lookUpIsbn(book.isbn13),
      );
      await expect(checkIn.chooseScreen).toBeVisible();
    });

    await test.step("wish for it while wishes fail", async () => {
      await checkIn.forceServerError(scanUrls.wishlist);
      await expectMutation(failing(scan.wishlist()), () =>
        checkIn.addToWishlist(),
      );
    });

    await test.step("check the error shows over the chooser", async () => {
      await expect(checkIn.errorMessage).toBeVisible();
      await expect(checkIn.chooseScreen).toBeVisible();
    });
  });
});

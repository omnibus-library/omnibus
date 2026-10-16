import { physical } from "../contracts/physical";
import { scan } from "../contracts/scan";
import { type BookRef, buildExternalBook, notInLibrary } from "../data/scan";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Each write is real, on a book no other spec reads. These run as the admin,
// since only an editor may remove a book along with its last copy.

test.describe("check-in chooser", () => {
  // A fileless book only shows in the library once a library path is set.
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
    const flow = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await flow.stubIsbnLookup(notInLibrary(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(book.isbn13), () =>
        flow.lookUpIsbn(book.isbn13),
      );
      await expect(flow.chooseScreen).toBeVisible();
    });

    const uuid = await test.step("add it to the collection", async () => {
      const { response } = await expectMutation(scan.physicalOnly(book), () =>
        flow.addToCollection(),
      );
      const added: BookRef = await response.json();
      createdBookUuids.add(added.book_uuid);
      await expect(flow.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(flow.successScreen).toContainText(book.title);
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
      createdBookUuids.add(book_uuid);
      return book_uuid;
    });

    await test.step("ask to remove its only copy", async () => {
      await bookDetailPage.goto(uuid);
      await expect(bookDetailPage.physicalPill).toBeVisible();
      await bookDetailPage.openRemoveCopyDialog();
      await expect(bookDetailPage.lastCopyDialog).toBeVisible();
    });

    // One click deletes the copy and then the book, which has no copy left.
    await test.step("remove the book from the library", async () => {
      await expectMutation(physical.deleteCopy(), () =>
        expectMutation(physical.deleteBook(uuid), () =>
          bookDetailPage.removeFromLibrary(),
        ),
      );
      createdBookUuids.delete(uuid);
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
    const flow = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await flow.stubIsbnLookup(notInLibrary(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(book.isbn13), () =>
        flow.lookUpIsbn(book.isbn13),
      );
      await expect(flow.chooseScreen).toBeVisible();
    });

    await test.step("add it to the wishlist", async () => {
      const { response } = await expectMutation(scan.wishlist("manual"), () =>
        flow.addToWishlist(),
      );
      const added: BookRef = await response.json();
      createdBookUuids.add(added.book_uuid);
      await expect(flow.successScreen).toContainText("On your wishlist");
      await expect(flow.successScreen).toContainText(book.title);
    });

    await test.step("check the wishlist shelf lists it", async () => {
      await libraryPage.goto();
      await libraryPage.selectShelf(adminWishlist);
      await expect(libraryPage.bookTile(book.title)).toBeVisible();
    });
  });

  // Deleting a fileless book takes its wishlist entries with it.
  test("drop a deleted book from the wishlist", async ({
    scanRequests,
    physicalRequests,
    shelfPage,
    adminWishlist,
    createdBookUuids,
  }) => {
    const book = buildExternalBook();

    const uuid =
      await test.step("wish for a book through the api", async () => {
        const added = await scanRequests.postWishlistEntry(book);
        await expect(added).toBeOK();
        const { book_uuid }: BookRef = await added.json();
        createdBookUuids.add(book_uuid);
        return book_uuid;
      });

    await test.step("check the wishlist lists it", async () => {
      await shelfPage.goto(adminWishlist.id);
      await expect(shelfPage.bookTile(book.title)).toBeVisible();
    });

    await test.step("delete the book through the api", async () => {
      await expect(await physicalRequests.deleteBook(uuid)).toBeOK();
      createdBookUuids.delete(uuid);
    });

    // An emptied wishlist leaves the library row, so check its own page.
    await test.step("check the wishlist no longer lists it", async () => {
      await shelfPage.goto(adminWishlist.id);
      await expect(shelfPage.bookTile(book.title)).toHaveCount(0);
    });
  });

  // Wishlists are public, but other readers' library rows leave them out, so
  // another reader opens one from the shelves index.
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
      createdBookUuids.add(book_uuid);
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
    const flow = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await flow.stubIsbnLookup(notInLibrary(book));
      await flow.forceServerError(scan.physicalOnly(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(book.isbn13), () =>
        flow.lookUpIsbn(book.isbn13),
      );
      await expect(flow.chooseScreen).toBeVisible();
    });

    await test.step("add it while adds fail", async () => {
      await expectMutation(failing(scan.physicalOnly(book)), () =>
        flow.addToCollection(),
      );
    });

    await test.step("check the error shows over the chooser", async () => {
      await expect(flow.errorMessage).toBeVisible();
      await expect(flow.chooseScreen).toBeVisible();
    });
  });

  test("stay on the chooser when adding to the wishlist fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const book = buildExternalBook();

    await test.step("look up a book only the providers know", async () => {
      await flow.stubIsbnLookup(notInLibrary(book));
      await flow.forceServerError(scan.wishlist("manual"));
      await checkInPage.goto();
      await expectMutation(scan.resolve(book.isbn13), () =>
        flow.lookUpIsbn(book.isbn13),
      );
      await expect(flow.chooseScreen).toBeVisible();
    });

    await test.step("wish for it while wishes fail", async () => {
      await expectMutation(failing(scan.wishlist("manual")), () =>
        flow.addToWishlist(),
      );
    });

    await test.step("check the error shows over the chooser", async () => {
      await expect(flow.errorMessage).toBeVisible();
      await expect(flow.chooseScreen).toBeVisible();
    });
  });
});

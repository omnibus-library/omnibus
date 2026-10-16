import { scan } from "../contracts/scan";
import {
  alreadyOwned,
  buildExternalBook,
  closeMatch,
  inLibraryUnowned,
  libraryBook,
  onWishlist,
} from "../data/scan";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Check-ins are stubbed because `physical_collection.spec.ts` reads TARGET and
// would see a real copy. `check_in_link_existing` makes the real write.

const ISBN = "9780441013593";
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-island")!;
const STUB_UUID = "island-uuid";
const LIBRARY_ISBN = "9780000000000";

test.describe("check-in lookup outcomes", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("call a print-only book a print copy", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    // A paper-only row: no file, a copy already filed (#2525).
    await test.step("look up a print-only library book", async () => {
      await flow.stubIsbnLookup(
        inLibraryUnowned(
          libraryBook(TARGET, STUB_UUID, {
            has_files: false,
            has_physical: true,
          }),
        ),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
    });

    await test.step("check the confirm calls it a print copy", async () => {
      await expect(flow.confirmScreen).not.toContainText("digitally");
      await expect(flow.confirmScreen).toContainText("print copy");
    });
  });

  test("check in a copy of a digital book after an exact isbn match", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const book = { uuid: STUB_UUID, isbn13: ISBN };
    const note = "Trade paperback, 2nd printing";

    await test.step("look up the digital book", async () => {
      await flow.stubIsbnLookup(
        inLibraryUnowned(libraryBook(TARGET, book.uuid)),
      );
      await flow.stubCheckIn(book.uuid);
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
    });

    // Typed at the lookup field, so the line must not call it a scan (#2247).
    await test.step("check the confirm describes the match", async () => {
      await expect(flow.bookCards).toContainText(TARGET.title);
      await expect(flow.confirmScreen).toContainText(
        "You already have this one digitally",
      );
      await expect(flow.confirmScreen).toContainText(`Entered ISBN ${ISBN}`);
    });

    await test.step("check in the copy with an edition note", async () => {
      await flow.enterNote(note);
      await expectMutation(scan.checkIn(book, note), () => flow.checkInCopy());
    });

    await test.step("check the copy joined the collection", async () => {
      await expect(flow.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(flow.successScreen).toContainText(TARGET.title);
      await expect(flow.viewBookLink).toBeVisible();
    });
  });

  test("cancel a confirm back to an empty lookup", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("look up a library book", async () => {
      await flow.stubIsbnLookup(
        inLibraryUnowned(libraryBook(TARGET, STUB_UUID)),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.confirmScreen).toBeVisible();
    });

    await test.step("cancel the confirm", async () => {
      await flow.cancelConfirmation();
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.isbnField).toHaveValue("");
    });
  });

  test("stay on the confirm when the check-in fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const book = { uuid: STUB_UUID, isbn13: ISBN };

    await test.step("look up a library book", async () => {
      await flow.stubIsbnLookup(
        inLibraryUnowned(libraryBook(TARGET, book.uuid)),
      );
      await flow.forceServerError(scan.checkIn(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.confirmScreen).toBeVisible();
    });

    await test.step("check in while check-ins fail", async () => {
      await expectMutation(failing(scan.checkIn(book)), () =>
        flow.checkInCopy(),
      );
    });

    await test.step("check the error shows over the confirm", async () => {
      await expect(flow.errorMessage).toBeVisible();
      await expect(flow.confirmScreen).toBeVisible();
    });
  });

  test("confirm a close match before checking in", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const scanned = buildExternalBook({
      isbn13: ISBN,
      title: "A Fuzzy-Matched Title",
      authors: ["Some Author"],
    });

    await test.step("look up an isbn with one close match", async () => {
      await flow.stubIsbnLookup(
        closeMatch(scanned, [
          libraryBook(TARGET, STUB_UUID, { isbn: LIBRARY_ISBN }),
        ]),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
    });

    await test.step("check both isbns are shown", async () => {
      await expect(flow.closeMatchScreen).toBeVisible();
      await expect(flow.screenHeading).toHaveText("Is this the book?");
      await expect(flow.closeMatchScreen).toContainText(
        `Entered ISBN ${scanned.isbn13}`,
      );
      await expect(flow.closeMatchScreen).toContainText(
        `Library edition ISBN ${LIBRARY_ISBN}`,
      );
    });

    await test.step("confirm the match", async () => {
      await flow.pickCloseMatch(TARGET.title);
      await expect(flow.confirmScreen).toBeVisible();
      await expect(flow.confirmScreen).toContainText(
        `Entered ISBN ${scanned.isbn13}`,
      );
    });
  });

  // An EPUB and its unattached audiobook share a title and author, so the
  // flow offers both instead of creating a print-only duplicate (#1791).
  test("pick between two library books that matched", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const scanned = buildExternalBook({
      isbn13: ISBN,
      title: "A Fuzzy-Matched Title",
      authors: ["Some Author"],
    });
    const audiobookTitle = `${TARGET.title} (Unabridged)`;

    await test.step("look up an isbn with two close matches", async () => {
      await flow.stubIsbnLookup(
        closeMatch(scanned, [
          libraryBook(TARGET, "epub-uuid", { isbn: LIBRARY_ISBN }),
          libraryBook(
            { title: audiobookTitle, authors: TARGET.authors },
            "audiobook-uuid",
          ),
        ]),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
    });

    await test.step("check both books are offered", async () => {
      await expect(flow.screenHeading).toHaveText("Which one is this?");
      await expect(flow.closeMatchPickButtons).toHaveCount(2);
      await expect(flow.bookCards).toHaveCount(2);
    });

    // The second candidate is the one only a picker can reach.
    await test.step("pick the audiobook", async () => {
      await flow.pickCloseMatch(audiobookTitle);
      await expect(flow.confirmScreen).toBeVisible();
      await expect(flow.bookCards).toContainText(audiobookTitle);
    });
  });

  test("decline a close match into the online chooser", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const scanned = buildExternalBook({
      isbn13: ISBN,
      title: "Definitely Not That Book",
      authors: ["Some Author"],
    });

    await test.step("look up an isbn with a close match", async () => {
      await flow.stubIsbnLookup(
        closeMatch(scanned, [libraryBook(TARGET, STUB_UUID)]),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.closeMatchScreen).toBeVisible();
    });

    await test.step("decline the match", async () => {
      await flow.declineCloseMatch();
      await expect(flow.chooseScreen).toBeVisible();
      await expect(flow.bookCards).toContainText(scanned.title);
    });
  });

  test("open an already-owned book straight from the lookup", async ({
    request,
    checkInPage,
    bookDetailPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("look up a book that already has a copy", async () => {
      await flow.stubIsbnLookup(
        alreadyOwned(libraryBook(TARGET, uuid, { has_physical: true })),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
    });

    await test.step("check the book's page opens instead", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      await expect(flow.root).toHaveCount(0);
    });
  });

  // The book they wished for is the one they now hold, so the flow offers to
  // file it rather than sending them to its page.
  test("check in a wishlisted book from the lookup", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const book = { uuid: STUB_UUID, isbn13: ISBN };

    await test.step("look up a book on the wishlist", async () => {
      await flow.stubIsbnLookup(
        onWishlist(libraryBook(TARGET, book.uuid, { has_files: false })),
      );
      await flow.stubCheckIn(book.uuid);
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
    });

    await test.step("check the confirm offers to file it", async () => {
      await checkInPage.assertDisplayed();
      await expect(flow.confirmScreen).toContainText("on your wishlist");
      await expect(flow.bookCards).toContainText(TARGET.title);
    });

    await test.step("check in the copy", async () => {
      await expectMutation(scan.checkIn(book), () => flow.checkInCopy());
    });

    await test.step("check the copy left the wishlist", async () => {
      await expect(flow.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(flow.successScreen).toContainText(TARGET.title);
      await expect(flow.offWishlistMessage).toContainText("off your wishlist");
    });
  });
});

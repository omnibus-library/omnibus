import { scan, scanUrls } from "../contracts/scan";
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

// Where a resolved ISBN lands past the lookup: the in-library confirm, the
// fuzzy (title, author) close match, the wishlist check-in, and the
// already-owned jump to the book's page. The providers are stubbed, and so is
// the check-in write: `physical_collection.spec.ts` reads `standalone-island`,
// so a real copy filed on it here would leak into that spec. The real write
// runs in `check_in_link_existing.spec.ts`, on a book reserved for it.

const ISBN = "9780441013593";
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-island")!;
const LIBRARY_ISBN = "9780000000000";

test.describe("check-in confirm and close match", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("word the confirm for a print-only book", async ({
    request,
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    // A paper-only row: no file, a copy already filed (#2525).
    await test.step("look up a print-only library book", async () => {
      await checkIn.stubIsbnLookup(
        inLibraryUnowned(
          libraryBook(TARGET, uuid, { has_files: false, has_physical: true }),
        ),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
    });

    await test.step("check the confirm calls it a print copy", async () => {
      await expect(checkIn.confirmScreen).not.toContainText("digitally");
      await expect(checkIn.confirmScreen).toContainText("print copy");
    });
  });

  test("check in a copy of a digital book after an exact isbn match", async ({
    request,
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const note = "Trade paperback, 2nd printing";

    await test.step("look up the digital book", async () => {
      await checkIn.stubIsbnLookup(inLibraryUnowned(libraryBook(TARGET, uuid)));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
    });

    // Typed at the lookup field, so the line must not call it a scan (#2247).
    await test.step("check the confirm describes the match", async () => {
      await expect(checkIn.bookCards).toContainText(TARGET.title);
      await expect(checkIn.confirmScreen).toContainText(
        "You already have this one digitally",
      );
      await expect(checkIn.confirmScreen).toContainText(`Entered ISBN ${ISBN}`);
    });

    await test.step("check in the copy with an edition note", async () => {
      await checkIn.enterNote(note);
      await checkIn.stubCheckIn(uuid);
      await expectMutation(scan.checkIn({ uuid, isbn13: ISBN }, note), () =>
        checkIn.checkInCopy(),
      );
    });

    await test.step("check the success screen", async () => {
      await expect(checkIn.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(checkIn.successScreen).toContainText(TARGET.title);
      await expect(checkIn.viewBookLink).toBeVisible();
    });
  });

  test("cancel a confirm back to an empty lookup", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("look up a library book", async () => {
      await checkIn.stubIsbnLookup(
        inLibraryUnowned(libraryBook(TARGET, "island-uuid")),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
      await expect(checkIn.confirmScreen).toBeVisible();
    });

    await test.step("cancel the confirm", async () => {
      await checkIn.cancelConfirmation();
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.isbnField).toHaveValue("");
    });
  });

  test("stay on the confirm when the check-in fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const book = { uuid: "island-uuid", isbn13: ISBN };

    await test.step("look up a library book", async () => {
      await checkIn.stubIsbnLookup(
        inLibraryUnowned(libraryBook(TARGET, book.uuid)),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
      await expect(checkIn.confirmScreen).toBeVisible();
    });

    await test.step("check in while check-ins fail", async () => {
      await checkIn.forceServerError(scanUrls.checkIn);
      await expectMutation(failing(scan.checkIn(book)), () =>
        checkIn.checkInCopy(),
      );
    });

    await test.step("check the error shows over the confirm", async () => {
      await expect(checkIn.errorMessage).toBeVisible();
      await expect(checkIn.confirmScreen).toBeVisible();
    });
  });

  test("confirm a close match into the check-in confirm", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const scanned = buildExternalBook({
      isbn13: ISBN,
      title: "A Fuzzy-Matched Title",
      authors: ["Some Author"],
    });

    await test.step("look up an isbn with one close match", async () => {
      await checkIn.stubIsbnLookup(
        closeMatch(scanned, [
          libraryBook(TARGET, "island-uuid", { isbn: LIBRARY_ISBN }),
        ]),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
    });

    await test.step("check both isbns are shown", async () => {
      await expect(checkIn.closeMatchScreen).toBeVisible();
      await expect(checkIn.screenHeading).toHaveText("Is this the book?");
      await expect(checkIn.closeMatchScreen).toContainText(
        `Entered ISBN ${scanned.isbn13}`,
      );
      await expect(checkIn.closeMatchScreen).toContainText(
        `Library edition ISBN ${LIBRARY_ISBN}`,
      );
    });

    await test.step("confirm the match", async () => {
      await checkIn.pickCloseMatch(0);
      await expect(checkIn.confirmScreen).toBeVisible();
      await expect(checkIn.confirmScreen).toContainText(
        `Entered ISBN ${scanned.isbn13}`,
      );
    });
  });

  // An EPUB and its unattached audiobook share a (title, author), so the
  // ladder offers both rather than minting a physical-only duplicate (#1791).
  test("pick between two library books that matched", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const scanned = buildExternalBook({
      isbn13: ISBN,
      title: "A Fuzzy-Matched Title",
      authors: ["Some Author"],
    });
    const audiobookTitle = `${TARGET.title} (Unabridged)`;

    await test.step("look up an isbn with two close matches", async () => {
      await checkIn.stubIsbnLookup(
        closeMatch(scanned, [
          libraryBook(TARGET, "epub-uuid", { isbn: LIBRARY_ISBN }),
          libraryBook(
            { title: audiobookTitle, authors: TARGET.authors },
            "audiobook-uuid",
          ),
        ]),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
    });

    await test.step("check both books are offered", async () => {
      await expect(checkIn.screenHeading).toHaveText("Which one is this?");
      await expect(checkIn.closeMatchPickButtons).toHaveCount(2);
      await expect(checkIn.bookCards).toHaveCount(2);
    });

    // The second candidate is the one only a picker can reach.
    await test.step("pick the second book", async () => {
      await checkIn.pickCloseMatch(1);
      await expect(checkIn.confirmScreen).toBeVisible();
      await expect(checkIn.bookCards).toContainText(audiobookTitle);
    });
  });

  test("decline a close match into the online chooser", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const scanned = buildExternalBook({
      isbn13: ISBN,
      title: "Definitely Not That Book",
      authors: ["Some Author"],
    });

    await test.step("look up an isbn with a close match", async () => {
      await checkIn.stubIsbnLookup(
        closeMatch(scanned, [libraryBook(TARGET, "island-uuid")]),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
      await expect(checkIn.closeMatchScreen).toBeVisible();
    });

    await test.step("decline the match", async () => {
      await checkIn.declineCloseMatch();
      await expect(checkIn.chooseScreen).toBeVisible();
      await expect(checkIn.bookCards).toContainText(scanned.title);
    });
  });

  test("open an already-owned book straight from the lookup", async ({
    request,
    checkInPage,
    bookDetailPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("look up a book that already has a copy", async () => {
      await checkIn.stubIsbnLookup(
        alreadyOwned(libraryBook(TARGET, uuid, { has_physical: true })),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
    });

    await test.step("check the book's page opens instead", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      await expect(checkIn.root).toHaveCount(0);
    });
  });

  // The book they wished for is the one they now hold, so the flow offers to
  // file it rather than sending them to its page.
  test("check in a wishlisted book from the lookup", async ({
    request,
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("look up a book on the wishlist", async () => {
      await checkIn.stubIsbnLookup(
        onWishlist(libraryBook(TARGET, uuid, { has_files: false })),
      );
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
    });

    await test.step("check the confirm offers to file it", async () => {
      await checkInPage.assertDisplayed();
      await expect(checkIn.confirmScreen).toContainText("on your wishlist");
      await expect(checkIn.bookCards).toContainText(TARGET.title);
    });

    await test.step("check in the copy", async () => {
      await checkIn.stubCheckIn(uuid);
      await expectMutation(scan.checkIn({ uuid, isbn13: ISBN }), () =>
        checkIn.checkInCopy(),
      );
    });

    await test.step("check the entry left the wishlist", async () => {
      await expect(checkIn.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(checkIn.successScreen).toContainText(TARGET.title);
      await expect(checkIn.offWishlistMessage).toContainText(
        "off your wishlist",
      );
    });
  });
});

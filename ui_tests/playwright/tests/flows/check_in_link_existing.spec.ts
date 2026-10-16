import { palette } from "../contracts/palette";
import { scan, scanUrls } from "../contracts/scan";
import { buildExternalBook, notInLibrary } from "../data/scan";
import { uniqueSuffix } from "../data/unique";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/libraryFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// "I already have this book": the escape hatch for a copy no rung of the
// matching ladder can place (#1790). A provider answers a print barcode with a
// placeholder title that shares nothing with the library book, so neither the
// ISBN nor the (title, author) rung bridges it. The lookup is stubbed; the
// library search, the check-in and the re-scan after it are real.
//
// TARGET is reserved for this spec in `fixtures/epubs.ts`: a filed copy is
// library-wide, and ISBN stays bound to TARGET once a copy is filed under it.

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "polyglot-2")!;
const TARGET_QUERY = "Cuentos";
const ISBN = "9781402894626";
const PLACEHOLDER = buildExternalBook({
  isbn13: ISBN,
  title: "Untitled Placeholder Release (Deluxe Limited Edition)",
  authors: ["Unknown Placeholder"],
  year: null,
});

test.describe("check-in link to an existing book", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the link picker layout", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("look up the placeholder isbn", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
      await expect(checkIn.chooseScreen).toBeVisible();
    });

    // It sits on the chooser, the screen that would otherwise mint a duplicate.
    await test.step("open the link picker from the chooser", async () => {
      await expect(checkIn.linkExistingButton).toBeVisible();
      await checkIn.openLinkPicker();
    });

    await test.step("check the picker is ready to search", async () => {
      await checkInPage.topNav.assertDisplayed();
      await expect(checkIn.linkScreen).toBeVisible();
      await expect(checkIn.screenHeading).toHaveText("Which book is this?");
      await expect(checkIn.libraryQueryField).toBeVisible();
      await expect(checkIn.searchLibraryButton).toBeDisabled();
      await expect(checkIn.linkEmptyMessage).toHaveCount(0);
      await expect(checkIn.linkBackButton).toBeVisible();
    });
  });

  test("link a copy to a library book without adding a book", async ({
    request,
    checkInPage,
    bookDetailPage,
    scanRequests,
    filedCopies,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const note = `Signed paperback ${uniqueSuffix()}`;

    await test.step("find the library book from the chooser", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
      await expect(checkIn.chooseScreen).toBeVisible();
      await checkIn.openLinkPicker();
      await expect(checkIn.linkScreen).toBeVisible();
      await expectMutation(palette.search(TARGET_QUERY), () =>
        checkIn.searchLibrary(TARGET_QUERY),
      );
      await expect(checkIn.linkResultsList).toContainText(TARGET.title);
      await expect(checkIn.linkPickButtons).toHaveCount(1);
    });

    // The pick lands on the ordinary confirm, so the copy goes through the one
    // existing write path.
    await test.step("pick it and check in the copy", async () => {
      await checkIn.pickLinkResult(0);
      await expect(checkIn.confirmScreen).toBeVisible();
      await checkIn.enterNote(note);
      filedCopies.push({ bookUuid: uuid, note });
      const { response } = await expectMutation(
        scan.checkIn({ uuid, isbn13: ISBN }, note),
        () => checkIn.checkInCopy(),
      );
      expect(await response.json()).toEqual({ book_uuid: uuid });
    });

    await test.step("check the success screen", async () => {
      await expect(checkIn.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(checkIn.successScreen).toContainText(TARGET.title);
    });

    await test.step("check the book's page shows the copy", async () => {
      await bookDetailPage.goto(uuid);
      await expect(bookDetailPage.physicalPill).toBeVisible();
      await expect(bookDetailPage.physicalCopyCard(note)).toBeVisible();
    });

    // The exact-identifier rung now answers, so no provider and no chooser.
    await test.step("check the isbn now resolves to the book", async () => {
      const rescan = await scanRequests.postResolve(ISBN);
      await expect(rescan).toBeOK();
      expect(await rescan.json()).toMatchObject({
        kind: "already_owned",
        book: { uuid },
      });
    });
  });

  test("stay on the confirm when the linked check-in fails", async ({
    request,
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("pick the library book from the chooser", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
      await expect(checkIn.chooseScreen).toBeVisible();
      await checkIn.openLinkPicker();
      await expect(checkIn.linkScreen).toBeVisible();
      await expectMutation(palette.search(TARGET_QUERY), () =>
        checkIn.searchLibrary(TARGET_QUERY),
      );
      await checkIn.pickLinkResult(0);
      await expect(checkIn.confirmScreen).toBeVisible();
    });

    await test.step("check in while check-ins fail", async () => {
      await checkIn.forceServerError(scanUrls.checkIn);
      await expectMutation(failing(scan.checkIn({ uuid, isbn13: ISBN })), () =>
        checkIn.checkInCopy(),
      );
    });

    // The reader keeps the picked book, free to retry.
    await test.step("check the error shows over the confirm", async () => {
      await expect(checkIn.errorMessage).toBeVisible();
      await expect(checkIn.confirmScreen).toBeVisible();
    });
  });

  test("go back to the chooser after a search with no match", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;
    const query = "zzzz no such book in this library zzzz";

    await test.step("search the library for nothing", async () => {
      await checkIn.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.goto();
      await expectMutation(scan.resolve(), () => checkIn.lookUpIsbn(ISBN));
      await expect(checkIn.chooseScreen).toBeVisible();
      await checkIn.openLinkPicker();
      await expect(checkIn.linkScreen).toBeVisible();
      await expectMutation(palette.search(query), () =>
        checkIn.searchLibrary(query),
      );
    });

    await test.step("check the picker says so", async () => {
      await expect(checkIn.linkEmptyMessage).toBeVisible();
      await expect(checkIn.linkResultsList).toHaveCount(0);
    });

    // Back to the outcome they left, still holding the looked-up book.
    await test.step("go back to the chooser", async () => {
      await checkIn.backToChooser();
      await expect(checkIn.chooseScreen).toBeVisible();
      await expect(checkIn.chooseScreen).toContainText(
        "Untitled Placeholder Release",
      );
    });
  });
});

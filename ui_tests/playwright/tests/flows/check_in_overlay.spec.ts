import { scan } from "../contracts/scan";
import {
  alreadyOwned,
  buildExternalBook,
  inLibraryUnowned,
  libraryBook,
} from "../data/scan";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The flow as a dialog over the current page, raised from the top nav at the
// desktop width that renders it. The `/check-in` deep link is covered by
// `check_in_lookup`, the camera by `check_in_scan`. Every scan call is stubbed,
// the write included, for the reason `check_in_confirm` gives: these tests
// assert the overlay's own state, which the stubs don't touch.

const ISBN = "9780441013593";
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "standalone-island")!;

test.describe("check-in overlay", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("open check-in over the library without navigating", async ({
    libraryPage,
  }) => {
    const overlay = libraryPage.checkInOverlay;

    await test.step("open the library", async () => {
      await libraryPage.goto();
      await libraryPage.topNav.assertDisplayed();
      await expect(overlay.scrim).toHaveCount(0);
    });

    await test.step("open check-in from the top nav", async () => {
      await libraryPage.topNav.openCheckIn();
    });

    // Raising the overlay must never start a webcam, so it opens on the fields.
    await test.step("check the flow floats over the library", async () => {
      await expect(overlay.scrim).toBeVisible();
      await expect(overlay.flowCard).toBeVisible();
      await expect(overlay.screenHeading).toHaveText("Check in a book");
      await expect(overlay.scannerPanel).toHaveCount(0);
      await libraryPage.assertDisplayed();
    });

    // The flow's own × links to the library, so the overlay hides it.
    await test.step("check the overlay has one way to close", async () => {
      await expect(overlay.closeButton).toBeVisible();
      await expect(overlay.cancelLink).toBeHidden();
    });
  });

  test("close the overlay with its close button", async ({ libraryPage }) => {
    const overlay = libraryPage.checkInOverlay;

    await test.step("open check-in over the library", async () => {
      await libraryPage.goto();
      await libraryPage.topNav.openCheckIn();
      await expect(overlay.scrim).toBeVisible();
    });

    await test.step("close it", async () => {
      await overlay.close();
      await expect(overlay.scrim).toHaveCount(0);
      await libraryPage.assertDisplayed();
    });
  });

  test("close the overlay by clicking outside it", async ({ libraryPage }) => {
    const overlay = libraryPage.checkInOverlay;

    await test.step("open check-in over the library", async () => {
      await libraryPage.goto();
      await libraryPage.topNav.openCheckIn();
      await expect(overlay.scrim).toBeVisible();
    });

    await test.step("click the scrim", async () => {
      await overlay.closeByClickingOutside();
      await expect(overlay.scrim).toHaveCount(0);
    });
  });

  // Opening moves focus into the dialog, so a keyboard user's Escape lands.
  test("close the overlay with escape", async ({ libraryPage }) => {
    const overlay = libraryPage.checkInOverlay;

    await test.step("open check-in over the library", async () => {
      await libraryPage.goto();
      await libraryPage.topNav.openCheckIn();
      await expect(overlay.scrim).toBeVisible();
      await expect(overlay.root).toBeFocused();
    });

    await test.step("press escape", async () => {
      await overlay.closeWithEscape();
      await expect(overlay.scrim).toHaveCount(0);
    });
  });

  // The clicked button unmounts with its stage, so focus is put back on the
  // panel or Escape is lost to `body` (#2525).
  test("close the overlay with escape after changing stage", async ({
    request,
    libraryPage,
    expectMutation,
  }) => {
    const overlay = libraryPage.checkInOverlay;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("look up a library book in the overlay", async () => {
      await overlay.stubIsbnLookup(inLibraryUnowned(libraryBook(TARGET, uuid)));
      await libraryPage.goto();
      await libraryPage.topNav.openCheckIn();
      await expect(overlay.scrim).toBeVisible();
      await expectMutation(scan.resolve(), () => overlay.lookUpIsbn(ISBN));
      await expect(overlay.confirmScreen).toBeVisible();
      await expect(overlay.root).toBeFocused();
    });

    await test.step("cancel back to the lookup", async () => {
      await overlay.cancelConfirmation();
      await expect(overlay.lookupScreen).toBeVisible();
      await expect(overlay.root).toBeFocused();
    });

    await test.step("press escape", async () => {
      await overlay.closeWithEscape();
      await overlay.assertDismissed();
      await libraryPage.assertDisplayed();
    });
  });

  // Every route builds its own layout, so the paths that navigate out of the
  // flow must dismiss the overlay themselves.
  test("view the checked-in book from the success screen", async ({
    request,
    libraryPage,
    bookDetailPage,
    expectMutation,
  }) => {
    const overlay = libraryPage.checkInOverlay;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("check in a library book in the overlay", async () => {
      await overlay.stubIsbnLookup(inLibraryUnowned(libraryBook(TARGET, uuid)));
      await overlay.stubCheckIn(uuid);
      await libraryPage.goto();
      await libraryPage.topNav.openCheckIn();
      await expect(overlay.scrim).toBeVisible();
      await expectMutation(scan.resolve(), () => overlay.lookUpIsbn(ISBN));
      await expect(overlay.confirmScreen).toBeVisible();
      await expectMutation(scan.checkIn({ uuid, isbn13: ISBN }), () =>
        overlay.checkInCopy(),
      );
      await expect(overlay.viewBookLink).toBeVisible();
    });

    await test.step("view the book", async () => {
      await overlay.viewBook();
    });

    await test.step("check its page shows without the overlay", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      await overlay.assertDismissed();
    });
  });

  test("open an already-owned book from an isbn lookup", async ({
    request,
    libraryPage,
    bookDetailPage,
    expectMutation,
  }) => {
    const overlay = libraryPage.checkInOverlay;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("look up a book that already has a copy", async () => {
      await overlay.stubIsbnLookup(
        alreadyOwned(libraryBook(TARGET, uuid, { has_physical: true })),
      );
      await libraryPage.goto();
      await libraryPage.topNav.openCheckIn();
      await expect(overlay.scrim).toBeVisible();
      await expectMutation(scan.resolve(), () => overlay.lookUpIsbn(ISBN));
    });

    await test.step("check its page shows without the overlay", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
      await expect(bookDetailPage.titleHeading).toHaveText(TARGET.title);
      await overlay.assertDismissed();
    });
  });

  test("open an already-owned book from a title search", async ({
    request,
    libraryPage,
    bookDetailPage,
    expectMutation,
  }) => {
    const overlay = libraryPage.checkInOverlay;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const found = buildExternalBook({
      isbn13: ISBN,
      title: TARGET.title,
      authors: TARGET.authors,
      year: null,
    });

    await test.step("search for a book that already has a copy", async () => {
      await overlay.stubTitleSearch([found]);
      await overlay.stubSearchPick(
        alreadyOwned(libraryBook(TARGET, uuid, { has_physical: true })),
      );
      await libraryPage.goto();
      await libraryPage.topNav.openCheckIn();
      await expect(overlay.scrim).toBeVisible();
      await expectMutation(scan.search(TARGET.title), () =>
        overlay.searchByTitle(TARGET.title),
      );
    });

    await test.step("pick it", async () => {
      await expectMutation(scan.resolveMeta(), () =>
        overlay.pickSearchResult(0),
      );
    });

    await test.step("check its page shows without the overlay", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
      await overlay.assertDismissed();
    });
  });
});

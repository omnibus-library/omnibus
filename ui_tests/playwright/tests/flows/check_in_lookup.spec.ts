import { scan, scanUrls } from "../contracts/scan";
import { unresolved } from "../data/scan";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// The flow's front door: ISBN entry and title search on one screen, with the
// camera behind an explicit button. Provider answers are stubbed so nothing
// rides on ambient server config; the `omnibus_db` wiremock suites cover the
// providers themselves.

const ISBN = "9780441013593";

test.describe("check-in lookup", () => {
  test("show the lookup layout", async ({ checkInPage }) => {
    const checkIn = checkInPage.flow;

    await test.step("open check-in", async () => {
      await checkInPage.goto();
    });

    await test.step("check both ways in are on screen", async () => {
      await checkInPage.assertDisplayed();
      await checkInPage.topNav.assertDisplayed();
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.screenHeading).toHaveText("Check in a book");
      await expect(checkIn.isbnField).toBeVisible();
      await expect(checkIn.titleField).toBeVisible();
      await expect(checkIn.scanBarcodeButton).toBeVisible();
    });

    await test.step("check nothing can be submitted yet", async () => {
      await expect(checkIn.findBookButton).toBeDisabled();
      await expect(checkIn.searchButton).toBeDisabled();
      await expect(checkIn.searchEmptyMessage).toHaveCount(0);
    });
  });

  test("open check-in without starting the camera", async ({ checkInPage }) => {
    const checkIn = checkInPage.flow;

    await test.step("open check-in", async () => {
      await checkInPage.goto();
    });

    // The camera starts when the scanner mounts, so no scanner means no webcam.
    await test.step("check no scanner is mounted", async () => {
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.scannerPanel).toHaveCount(0);
      await expect(checkIn.scannerVideo).toHaveCount(0);
    });
  });

  test("reveal the camera with the scan button", async ({ checkInPage }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the scanner from the lookup", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
    });

    await test.step("check the scanner replaces the lookup", async () => {
      await expect(checkIn.scanScreen).toBeVisible();
      await expect(checkIn.scannerPanel).toBeVisible();
      await expect(checkIn.lookupScreen).toHaveCount(0);
    });
  });

  test("enable find book once the check digit validates", async ({
    checkInPage,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("open check-in", async () => {
      await checkInPage.goto();
      await expect(checkIn.findBookButton).toBeDisabled();
    });

    // Right length, wrong check digit: the case a shape-only gate misses.
    await test.step("enter an isbn with a wrong check digit", async () => {
      await checkIn.enterIsbn("9780441013539");
      await expect(checkIn.findBookButton).toBeDisabled();
    });

    await test.step("enter a valid isbn", async () => {
      await checkIn.enterIsbn(ISBN);
      await expect(checkIn.findBookButton).toBeEnabled();
    });
  });

  test("search by title after an unresolved isbn", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("look up an isbn nobody knows", async () => {
      await checkIn.stubIsbnLookup(unresolved());
      await checkInPage.goto();
      await checkIn.enterIsbn(ISBN);
      await expectMutation(scan.resolve(ISBN), () => checkIn.findBook());
      await expect(checkIn.unresolvedScreen).toBeVisible();
    });

    await test.step("search by title instead", async () => {
      await checkIn.searchByTitleInstead();
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.titleField).toBeVisible();
    });
  });

  test("keep the typed isbn when a lookup fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("look up an isbn while lookups fail", async () => {
      await checkIn.forceServerError(scanUrls.resolve);
      await checkInPage.goto();
      await checkIn.enterIsbn(ISBN);
      await expectMutation(failing(scan.resolve(ISBN)), () =>
        checkIn.findBook(),
      );
    });

    // Back where they typed, digits intact, not on a keypad they never chose.
    await test.step("check the error shows over the same fields", async () => {
      await expect(checkIn.errorMessage).toBeVisible();
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.isbnField).toHaveValue(ISBN);
    });
  });

  test("cancel check-in back to the library", async ({
    checkInPage,
    libraryPage,
  }) => {
    await test.step("open check-in", async () => {
      await checkInPage.goto();
      await expect(checkInPage.flow.root).toBeVisible();
    });

    await test.step("cancel the flow", async () => {
      await checkInPage.flow.cancelCheckIn();
    });

    await test.step("check the library shows without the flow", async () => {
      await libraryPage.assertDisplayed();
      await expect(libraryPage.titleHeading).toHaveText("Your Library");
      await expect(checkInPage.flow.root).toHaveCount(0);
    });
  });

  test("show the open library note without a google books key", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("open check-in with no key configured", async () => {
      await checkIn.stubGoogleBooksKey(false);
      await expectMutation(scan.googleBooksConfigured(), () =>
        checkInPage.goto(),
      );
    });

    await test.step("check the note explains the fallback", async () => {
      await expect(checkIn.fallbackNoteMessage).toContainText(
        "Without a Google Books API key",
      );
      await expect(checkIn.fallbackNoteMessage).toContainText(
        "Set up your Google Books API key in Settings",
      );
    });
  });

  test("hide the open library note with a google books key", async ({
    checkInPage,
    expectMutation,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("open check-in with a key configured", async () => {
      await checkIn.stubGoogleBooksKey(true);
      await expectMutation(scan.googleBooksConfigured(), () =>
        checkInPage.goto(),
      );
    });

    await test.step("check no note shows", async () => {
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.fallbackNoteMessage).toHaveCount(0);
    });
  });
});

import { scan } from "../contracts/scan";
import { unresolved } from "../data/scan";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";

// These tests stub provider answers so server settings can't change them.

const ISBN = "9780441013593";

test.describe("check-in lookup", () => {
  test("show the lookup layout", async ({ checkInPage }) => {
    const flow = checkInPage.flow;

    await test.step("open check-in", async () => {
      await checkInPage.goto();
    });

    await test.step("check both ways in are on screen", async () => {
      await checkInPage.assertDisplayed();
      await checkInPage.topNav.assertDisplayed();
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.screenHeading).toHaveText("Check in a book");
      await expect(flow.isbnField).toBeVisible();
      await expect(flow.titleField).toBeVisible();
      await expect(flow.scanBarcodeButton).toBeVisible();
    });

    await test.step("check nothing can be submitted yet", async () => {
      await expect(flow.findBookButton).toBeDisabled();
      await expect(flow.searchButton).toBeDisabled();
      await expect(flow.searchEmptyMessage).toHaveCount(0);
    });
  });

  test("open check-in without starting the camera", async ({ checkInPage }) => {
    const flow = checkInPage.flow;

    await test.step("open check-in", async () => {
      await checkInPage.goto();
    });

    // The camera starts when the scanner mounts, so no scanner means no webcam.
    await test.step("check no scanner is mounted", async () => {
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.scannerPanel).toHaveCount(0);
      await expect(flow.scannerVideo).toHaveCount(0);
    });
  });

  test("reveal the camera with the scan button", async ({ checkInPage }) => {
    const flow = checkInPage.flow;

    await test.step("open the scanner from the lookup", async () => {
      await checkInPage.goto();
      await flow.openScanner();
    });

    await test.step("check the scanner replaces the lookup", async () => {
      await expect(flow.scanScreen).toBeVisible();
      await expect(flow.scannerPanel).toBeVisible();
      await expect(flow.lookupScreen).toHaveCount(0);
    });
  });

  test("enable find book once the check digit validates", async ({
    checkInPage,
  }) => {
    const flow = checkInPage.flow;

    await test.step("open check-in", async () => {
      await checkInPage.goto();
      await expect(flow.findBookButton).toBeDisabled();
    });

    // Right length but wrong check digit, which a length check alone misses.
    await test.step("enter an isbn with a wrong check digit", async () => {
      await flow.enterIsbn("9780441013539");
      await expect(flow.findBookButton).toBeDisabled();
    });

    await test.step("enter a valid isbn", async () => {
      await flow.enterIsbn(ISBN);
      await expect(flow.findBookButton).toBeEnabled();
    });
  });

  test("search by title after an unresolved isbn", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("look up an isbn nobody knows", async () => {
      await flow.stubIsbnLookup(unresolved());
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.unresolvedScreen).toBeVisible();
    });

    await test.step("search by title instead", async () => {
      await flow.searchByTitleInstead();
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.titleField).toBeVisible();
    });
  });

  test("keep the typed isbn when a lookup fails", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("look up an isbn while lookups fail", async () => {
      await flow.forceServerError(scan.resolve(ISBN));
      await checkInPage.goto();
      await expectMutation(failing(scan.resolve(ISBN)), () =>
        flow.lookUpIsbn(ISBN),
      );
    });

    // The reader stays on the lookup with their digits, not on the keypad.
    await test.step("check the error shows over the same fields", async () => {
      await expect(flow.errorMessage).toBeVisible();
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.isbnField).toHaveValue(ISBN);
    });
  });

  test("cancel check-in back to the library", async ({
    checkInPage,
    libraryPage,
  }) => {
    const flow = checkInPage.flow;

    await test.step("open check-in", async () => {
      await checkInPage.goto();
      await expect(flow.root).toBeVisible();
    });

    await test.step("cancel the flow", async () => {
      await flow.cancelCheckIn();
    });

    await test.step("check the library shows without the flow", async () => {
      await libraryPage.assertDisplayed();
      await expect(libraryPage.titleHeading).toHaveText("Your Library");
      await expect(flow.root).toHaveCount(0);
    });
  });

  test("show the open library note without a google books key", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("open check-in with no key configured", async () => {
      await flow.stubGoogleBooksKey(false);
      await expectMutation(scan.googleBooksConfigured(), () =>
        checkInPage.goto(),
      );
    });

    await test.step("check the note explains the fallback", async () => {
      await expect(flow.fallbackNoteMessage).toContainText(
        "Without a Google Books API key",
      );
      await expect(flow.fallbackNoteMessage).toContainText(
        "Set up your Google Books API key in Settings",
      );
    });
  });

  test("hide the open library note with a google books key", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("open check-in with a key configured", async () => {
      await flow.stubGoogleBooksKey(true);
      await expectMutation(scan.googleBooksConfigured(), () =>
        checkInPage.goto(),
      );
    });

    await test.step("check no note shows", async () => {
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.fallbackNoteMessage).toHaveCount(0);
    });
  });
});

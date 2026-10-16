import { expect, test } from "../fixtures/pageFixtures";

// Headless Chromium refuses `getUserMedia` without a fake device, so every run
// here lands on the permission-denied branch: the fallback worth pinning, since
// a scanner nobody can grant the camera to must still reach manual entry. The
// decode itself is covered by the decoder's unit tests and device QA.

test.describe("check-in scanner", () => {
  test("show the scanner layout", async ({ checkInPage }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the scanner", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
      await expect(checkIn.scanScreen).toBeVisible();
    });

    // The viewfinder and its keypad link mount together, so manual entry is
    // always within reach.
    await test.step("check the viewfinder and its way out", async () => {
      await checkInPage.topNav.assertDisplayed();
      await expect(checkIn.screenHeading).toHaveText("Scan a barcode");
      await expect(checkIn.scannerPanel).toBeVisible();
      await expect(checkIn.enterIsbnInsteadButton).toBeVisible();
    });
  });

  test("fall back to manual entry when the camera is refused", async ({
    checkInPage,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the scanner", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
      await expect(checkIn.scanScreen).toBeVisible();
    });

    await test.step("check the keypad link takes over", async () => {
      await expect(checkIn.scannerStatusMessage).toContainText("ISBN");
      await expect(checkIn.scannerVideo).toBeHidden();
      await expect(checkIn.enterIsbnInsteadButton).toHaveClass(/primary/);
    });

    await test.step("enter the isbn by hand", async () => {
      await checkIn.enterIsbnInstead();
      await expect(checkIn.keypadScreen).toBeVisible();
    });
  });

  test("enable find book on the keypad once the check digit validates", async ({
    checkInPage,
  }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the keypad", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
      await expect(checkIn.scanScreen).toBeVisible();
      await checkIn.enterIsbnInstead();
      await expect(checkIn.findBookButton).toBeDisabled();
    });

    await test.step("type twelve of the thirteen digits", async () => {
      await checkIn.typeOnKeypad("978044101359");
      await expect(checkIn.isbnProgressStrip).toHaveAttribute(
        "data-filled",
        "12",
      );
      await expect(checkIn.findBookButton).toBeDisabled();
    });

    // Right length, so only the check digit can catch it.
    await test.step("type a wrong check digit", async () => {
      await checkIn.typeOnKeypad("7");
      await expect(checkIn.findBookButton).toBeDisabled();
    });

    await test.step("replace it with the right one", async () => {
      await checkIn.deleteLastDigit();
      await checkIn.typeOnKeypad("3");
      await expect(checkIn.isbnField).toHaveValue("9780441013593");
      await expect(checkIn.findBookButton).toBeEnabled();
    });
  });

  test("return to the scanner from manual entry", async ({ checkInPage }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the keypad from the scanner", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
      await expect(checkIn.scanScreen).toBeVisible();
      await checkIn.enterIsbnInstead();
      await expect(checkIn.keypadScreen).toBeVisible();
    });

    await test.step("go back to the scanner", async () => {
      await checkIn.openScanner();
      await expect(checkIn.scanScreen).toBeVisible();
    });
  });

  // Plenty of copies carry a barcode no ISBN index knows, so the title search
  // must not cost a doomed lookup first.
  test("open the title search from the scanner", async ({ checkInPage }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the scanner", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
      await expect(checkIn.scanScreen).toBeVisible();
    });

    await test.step("search by title", async () => {
      await checkIn.openTitleSearch();
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.titleSearchForm).toBeVisible();
    });
  });

  test("open the title search from manual entry", async ({ checkInPage }) => {
    const checkIn = checkInPage.flow;

    await test.step("open the keypad from the scanner", async () => {
      await checkInPage.goto();
      await checkIn.openScanner();
      await expect(checkIn.scanScreen).toBeVisible();
      await checkIn.enterIsbnInstead();
      await expect(checkIn.keypadScreen).toBeVisible();
    });

    await test.step("search by title", async () => {
      await checkIn.openTitleSearch();
      await expect(checkIn.lookupScreen).toBeVisible();
      await expect(checkIn.titleSearchForm).toBeVisible();
    });
  });
});

import { expect, test } from "../fixtures/pageFixtures";

// Headless Chromium refuses the camera, so every test lands on the denied
// branch: the fallback worth pinning. Decoding is covered by unit tests.

test.describe("check-in scanner", () => {
  test("show the scanner layout", async ({ checkInPage }) => {
    const flow = checkInPage.flow;

    await test.step("open the scanner", async () => {
      await checkInPage.goto();
      await flow.openScanner();
      await expect(flow.scanScreen).toBeVisible();
    });

    // The viewfinder and its keypad link mount together, so manual entry is
    // always within reach.
    await test.step("check the viewfinder and its way out", async () => {
      await checkInPage.topNav.assertDisplayed();
      await expect(flow.screenHeading).toHaveText("Scan a barcode");
      await expect(flow.scannerPanel).toBeVisible();
      await expect(flow.enterIsbnInsteadButton).toBeVisible();
    });
  });

  test("fall back to manual entry when the camera is refused", async ({
    checkInPage,
  }) => {
    const flow = checkInPage.flow;

    await test.step("open the scanner", async () => {
      await checkInPage.goto();
      await flow.openScanner();
      await expect(flow.scanScreen).toBeVisible();
    });

    await test.step("check the keypad link takes over", async () => {
      await expect(flow.scannerStatusMessage).toContainText("ISBN");
      await expect(flow.scannerVideo).toBeHidden();
      await expect(flow.enterIsbnInsteadButton).toHaveClass(/primary/);
    });

    await test.step("enter the isbn by hand", async () => {
      await flow.enterIsbnInstead();
      await expect(flow.keypadScreen).toBeVisible();
    });
  });

  test("enable find book on the keypad once the check digit validates", async ({
    checkInPage,
  }) => {
    const flow = checkInPage.flow;

    await test.step("open the keypad", async () => {
      await checkInPage.goto();
      await flow.openScanner();
      await expect(flow.scanScreen).toBeVisible();
      await flow.enterIsbnInstead();
      await expect(flow.findBookButton).toBeDisabled();
    });

    await test.step("type twelve of the thirteen digits", async () => {
      await flow.typeOnKeypad("978044101359");
      await expect(flow.isbnProgressStrip).toHaveAttribute("data-filled", "12");
      await expect(flow.findBookButton).toBeDisabled();
    });

    // Right length, so only the check digit can catch it.
    await test.step("type a wrong check digit", async () => {
      await flow.typeOnKeypad("7");
      await expect(flow.findBookButton).toBeDisabled();
    });

    await test.step("replace it with the right one", async () => {
      await flow.deleteLastDigit();
      await flow.typeOnKeypad("3");
      await expect(flow.isbnField).toHaveValue("9780441013593");
      await expect(flow.findBookButton).toBeEnabled();
    });
  });

  test("return to the scanner from manual entry", async ({ checkInPage }) => {
    const flow = checkInPage.flow;

    await test.step("open the keypad from the scanner", async () => {
      await checkInPage.goto();
      await flow.openScanner();
      await expect(flow.scanScreen).toBeVisible();
      await flow.enterIsbnInstead();
      await expect(flow.keypadScreen).toBeVisible();
    });

    await test.step("go back to the scanner", async () => {
      await flow.openScanner();
      await expect(flow.scanScreen).toBeVisible();
    });
  });

  // Plenty of copies carry a barcode no ISBN index knows, so the title search
  // must not cost a doomed lookup first.
  test("open the title search from the scanner", async ({ checkInPage }) => {
    const flow = checkInPage.flow;

    await test.step("open the scanner", async () => {
      await checkInPage.goto();
      await flow.openScanner();
      await expect(flow.scanScreen).toBeVisible();
    });

    await test.step("search by title", async () => {
      await flow.openTitleSearch();
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.titleSearchForm).toBeVisible();
    });
  });

  test("open the title search from manual entry", async ({ checkInPage }) => {
    const flow = checkInPage.flow;

    await test.step("open the keypad from the scanner", async () => {
      await checkInPage.goto();
      await flow.openScanner();
      await expect(flow.scanScreen).toBeVisible();
      await flow.enterIsbnInstead();
      await expect(flow.keypadScreen).toBeVisible();
    });

    await test.step("search by title", async () => {
      await flow.openTitleSearch();
      await expect(flow.lookupScreen).toBeVisible();
      await expect(flow.titleSearchForm).toBeVisible();
    });
  });
});

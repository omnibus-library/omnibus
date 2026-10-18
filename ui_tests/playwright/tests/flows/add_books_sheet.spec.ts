import { expect, test } from "../fixtures/pageFixtures";

// The tab bar and its raised centre action render only below the phone
// breakpoint. The native shell renders the same SSR tree in a WebView, so this
// flow covers web-phone and mobile alike.
test.describe("add-books sheet (phone viewport)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("show the center action in the tab bar", async ({ libraryPage }) => {
    const { tabBar, topNav } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    // Series left the bar for the centre action, so four tabs split around it.
    await test.step("check the tab bar and its center action show", async () => {
      await expect(topNav.libraryLink).toBeVisible();
      await expect(tabBar.centerActionButton).toBeVisible();
      await expect(tabBar.centerActionButton).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });

  test("open the sheet from the center action with scan highlighted", async ({
    libraryPage,
  }) => {
    const { tabBar, addBooksSheet } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
      await expect(addBooksSheet.root).toHaveCount(0);
    });

    await test.step("press the center action", async () => {
      await tabBar.openAddBooksSheet();
    });

    await test.step("check the sheet offers scan first, highlighted", async () => {
      await expect(addBooksSheet.root).toBeVisible();
      await expect(tabBar.centerActionButton).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(addBooksSheet.rows).toHaveText([
        /Scan a barcode/,
        /Upload a file/,
        /Enter an ISBN/,
      ]);
      await expect(addBooksSheet.scanRow).toHaveClass(/m-add-row--primary/);
    });
  });

  test("scan from the sheet to open the check-in overlay", async ({
    libraryPage,
  }) => {
    const { tabBar, addBooksSheet, checkInOverlay } = libraryPage;

    await test.step("open the sheet", async () => {
      await libraryPage.goto();
      await tabBar.openAddBooksSheet();
    });

    await test.step("choose scan", async () => {
      await addBooksSheet.chooseScan();
    });

    // Check-in is an overlay, not a route: the flow floats over the page.
    await test.step("check the overlay opens over the library and the sheet closes", async () => {
      await expect(checkInOverlay.scrim).toBeVisible();
      await expect(checkInOverlay.flowCard).toBeVisible();
      await libraryPage.assertDisplayed();
      await expect(addBooksSheet.root).toHaveCount(0);
    });
  });

  test("upload from the sheet to open the add-books page", async ({
    libraryPage,
    addBooksPage,
  }) => {
    const { tabBar, addBooksSheet } = libraryPage;

    await test.step("open the sheet", async () => {
      await libraryPage.goto();
      await tabBar.openAddBooksSheet();
    });

    await test.step("choose upload", async () => {
      await addBooksSheet.chooseUpload();
    });

    await test.step("check the add-books page opens and the sheet closes", async () => {
      await addBooksPage.assertDisplayed();
      await expect(addBooksPage.fileInput).toBeAttached();
      await expect(addBooksSheet.root).toHaveCount(0);
    });
  });

  test("hide upload from a reader who may not upload at either width", async ({
    readerLibraryPage,
  }) => {
    const { tabBar, topNav, addBooksSheet } = readerLibraryPage;

    await test.step("open the library as the reader", async () => {
      await readerLibraryPage.goto();
    });

    // The worker's reader may not upload (see `buildReader`), but checking in a
    // physical copy needs no permission, so the sheet stays.
    await test.step("check the phone sheet leaves out upload", async () => {
      await tabBar.openAddBooksSheet();
      await expect(addBooksSheet.rows).toHaveText([
        /Scan a barcode/,
        /Enter an ISBN/,
      ]);
      await expect(addBooksSheet.uploadOffer).toHaveCount(0);
    });

    await test.step("check the desktop nav leaves out add books", async () => {
      await tabBar.widenToDesktop();
      await expect(topNav.checkInButton).toBeVisible();
      await expect(topNav.addBooksButton).toHaveCount(0);
    });
  });

  test("dismiss the sheet from its scrim without navigating", async ({
    libraryPage,
  }) => {
    const { tabBar, addBooksSheet } = libraryPage;

    await test.step("open the sheet", async () => {
      await libraryPage.goto();
      await tabBar.openAddBooksSheet();
      await expect(addBooksSheet.root).toBeVisible();
    });

    await test.step("click the scrim outside the sheet", async () => {
      await addBooksSheet.dismissByScrim();
    });

    await test.step("check the sheet closes and the page stays", async () => {
      await expect(addBooksSheet.root).toHaveCount(0);
      await libraryPage.assertDisplayed();
    });
  });
});

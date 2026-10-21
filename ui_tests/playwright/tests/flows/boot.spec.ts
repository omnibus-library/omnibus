import { expect, test } from "../fixtures/pageFixtures";

// Until the wasm client hydrates, the server-rendered page is all a reader
// sees (#2641), so it must already show the nav and loaders, never an empty
// state the data hasn't confirmed. Each test holds the wasm download to pin it.
test.describe("pre-hydration page", () => {
  test("show the pre-hydration library layout", async ({
    libraryPage,
    preHydration,
  }) => {
    const release = await test.step("hold the client download", () =>
      preHydration.hold());

    await test.step("open the server-rendered library", async () => {
      await libraryPage.gotoBeforeHydration();
    });

    // Skeletons only: the library never shows the page loader's book.
    await test.step("check the nav and skeletons show", async () => {
      await expect(preHydration.hydratedMarker).toHaveCount(0);
      await libraryPage.topNav.assertDisplayed();
      await expect(libraryPage.loading).toBeVisible();
      await expect(libraryPage.shelfGallery.allBooksCount).toHaveCount(0);
      await expect(preHydration.pageLoaderMark).toHaveCount(0);
      await expect(preHydration.zeroBooksText).toHaveCount(0);
    });

    await test.step("release the download", async () => {
      await release();
      await expect(libraryPage.loading).toHaveCount(0);
    });
  });

  test("show nav and the page loader on other pages before the client runs", async ({
    authorsIndexPage,
    preHydration,
  }) => {
    const release = await test.step("hold the client download", () =>
      preHydration.hold());

    await test.step("open the server-rendered authors page", async () => {
      await authorsIndexPage.gotoBeforeHydration();
    });

    await test.step("check the nav and page loader show", async () => {
      await expect(preHydration.hydratedMarker).toHaveCount(0);
      await authorsIndexPage.topNav.assertDisplayed();
      await expect(preHydration.authorsLoader).toBeVisible();
    });

    await test.step("release the download", async () => {
      await release();
      await expect(preHydration.authorsLoader).toHaveCount(0);
      await expect(authorsIndexPage.filterField).toBeVisible();
    });
  });

  test("wear the saved theme before the client runs", async ({
    libraryPage,
    preHydration,
  }) => {
    const release =
      await test.step("save a theme and hold the client download", async () => {
        await libraryPage.presetTheme("sepia");
        return preHydration.hold();
      });

    await test.step("open the server-rendered library", async () => {
      await libraryPage.gotoBeforeHydration();
    });

    // Only the inline pre-paint script can have set it: the client that
    // normally applies the saved theme is still held.
    await test.step("check the page wears the theme", async () => {
      await expect(preHydration.hydratedMarker).toHaveCount(0);
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "sepia",
      );
    });

    await test.step("release the download", async () => {
      await release();
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "sepia",
      );
    });
  });
});

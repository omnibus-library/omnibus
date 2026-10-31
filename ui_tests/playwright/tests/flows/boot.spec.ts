import { expect, test } from "../fixtures/pageFixtures";

// Until the client's bundle runs, `index.html` is all a reader sees, so it
// must already show a loader, never an empty state the data hasn't confirmed.
// Each test holds the bundle download to pin it.
test.describe("page before the client runs", () => {
  test("show the page loader before the client runs", async ({
    libraryPage,
    preHydration,
  }) => {
    const release = await test.step("hold the client download", () =>
      preHydration.hold());

    await test.step("open the library", async () => {
      await libraryPage.gotoBeforeClientRuns();
    });

    await test.step("check the loader shows and no empty library", async () => {
      await expect(preHydration.pageLoader).toBeVisible();
      await expect(libraryPage.shelfGallery.allBooksCount).toHaveCount(0);
      await expect(preHydration.zeroBooksText).toHaveCount(0);
    });

    await test.step("release the download", async () => {
      await release();
      await libraryPage.assertDisplayed();
      await expect(preHydration.pageLoader).toHaveCount(0);
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

    await test.step("open the library", async () => {
      await libraryPage.gotoBeforeClientRuns();
    });

    // Only the inline pre-paint script can have set it: the client that
    // normally applies the saved theme is still held.
    await test.step("check the page wears the theme", async () => {
      await expect(preHydration.pageLoader).toBeVisible();
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "sepia",
      );
    });

    await test.step("release the download", async () => {
      await release();
      await libraryPage.assertDisplayed();
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "sepia",
      );
    });
  });
});

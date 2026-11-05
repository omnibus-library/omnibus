import { expect, test } from "../fixtures/pageFixtures";

// Each item's own flow has its spec: `check_in_overlay` and `add_books` open
// theirs through this menu.
test.describe("add menu", () => {
  test("show the add menu layout", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the add menu over the library", async () => {
      await libraryPage.goto();
      await topNav.openAddMenu();
    });

    await test.step("check it offers the three ways to add a book", async () => {
      await expect(topNav.addButton).toHaveAttribute("aria-expanded", "true");
      await expect(topNav.uploadBookFilesItem).toBeVisible();
      await expect(topNav.addCopyItem).toBeVisible();
      await expect(topNav.addToWishlistItem).toBeVisible();
    });
  });

  test("close the add menu with escape", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the add menu over the library", async () => {
      await libraryPage.goto();
      await topNav.openAddMenu();
      await expect(topNav.addMenu).toBeVisible();
    });

    await test.step("press escape", async () => {
      await topNav.closeAddMenuWithEscape();
    });

    await test.step("check the menu closes and hands focus back", async () => {
      await expect(topNav.addMenu).toHaveCount(0);
      await expect(topNav.addButton).toBeFocused();
    });
  });

  test("open the wishlist search from the add menu", async ({
    libraryPage,
    wishlistsPage,
  }) => {
    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("choose add to your wishlist", async () => {
      await libraryPage.topNav.openAddToWishlist();
    });

    await test.step("check wishlists opens with its search ready", async () => {
      await wishlistsPage.assertDisplayed();
      await expect(wishlistsPage.addSearchField).toBeFocused();
    });
  });
});

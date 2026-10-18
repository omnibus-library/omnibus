import { expect, test } from "../fixtures/pageFixtures";

// The web build keeps the choice under `omn.theme` in localStorage and applies
// it in a post-hydration effect, so SSR markup stays deterministic. Each test
// starts with empty localStorage and asserts `data-theme`, which is the contract.

test.describe("theme toggle", () => {
  test("show the dark theme on first paint", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the theme is dark", async () => {
      await expect(topNav.themeRoot).toBeVisible();
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "dark");
    });

    await test.step("check the menu offers the themes", async () => {
      await topNav.openUserMenu();
      await expect(topNav.themeButton("dark")).toBeVisible();
      await expect(topNav.themeButton("light")).toBeVisible();
    });
  });

  test("persist the light theme across a reload", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("choose the light theme", async () => {
      await libraryPage.goto();
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "dark");
      await topNav.openUserMenu();
      await topNav.selectTheme("light");
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "light");
    });

    await test.step("check the switch settles and is stored", async () => {
      // The switch holds a `theme-snap` class that pauses CSS transitions for
      // one repaint; if it never clears, hover transitions stay dead.
      await expect(topNav.themeRoot).toHaveAttribute("class", "atrium");
      expect(await topNav.storedTheme()).toBe("light");
    });

    await test.step("reload", async () => {
      // SSR still renders dark; the post-hydration effect then flips it.
      await libraryPage.reload();
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "light");
    });
  });

  test("persist the black theme across a reload", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("choose the black theme", async () => {
      await libraryPage.goto();
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "dark");
      await topNav.openUserMenu();
      await topNav.selectTheme("black");
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "black");
      expect(await topNav.storedTheme()).toBe("black");
    });

    await test.step("reload", async () => {
      await libraryPage.reload();
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "black");
    });
  });

  test("flip back to dark after choosing light", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("choose the light theme", async () => {
      await libraryPage.goto();
      // Selecting a theme leaves the menu open, so a second choice needs no reopen.
      await topNav.openUserMenu();
      await topNav.selectTheme("light");
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "light");
    });

    await test.step("choose the dark theme", async () => {
      await topNav.selectTheme("dark");
      await expect(topNav.themeRoot).toHaveAttribute("data-theme", "dark");
      expect(await topNav.storedTheme()).toBe("dark");
    });
  });
});

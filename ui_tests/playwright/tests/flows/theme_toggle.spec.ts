import { expect, test } from "../fixtures/pageFixtures";

// One segmented control lives in the user menu and again in Settings ›
// Preferences, where it applies to this device alone. The web build keeps the
// choice under `omn.theme` in localStorage and applies it in a post-hydration
// effect, so SSR markup stays deterministic. Each test starts with empty
// localStorage and asserts `data-theme`, which is the contract.

test.describe("theme toggle", () => {
  test("show the dark theme on first paint", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the theme is dark", async () => {
      await expect(libraryPage.themeRoot).toBeVisible();
      await expect(libraryPage.themeRoot).toHaveAttribute("data-theme", "dark");
    });

    await test.step("check the menu marks the dark theme", async () => {
      await topNav.openUserMenu();
      await expect(topNav.themeButton("dark")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(topNav.themeButton("light")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  test("persist the light theme across a reload", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("choose the light theme", async () => {
      await libraryPage.goto();
      await expect(libraryPage.themeRoot).toHaveAttribute("data-theme", "dark");
      await topNav.openUserMenu();
      await topNav.selectTheme("light");
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "light",
      );
    });

    await test.step("check the switch settles and is stored", async () => {
      // The switch holds a `theme-snap` class that pauses CSS transitions for
      // one repaint; if it never clears, hover transitions stay dead.
      await expect(libraryPage.themeRoot).toHaveAttribute("class", "atrium");
      expect(await libraryPage.storedTheme()).toBe("light");
    });

    await test.step("reload", async () => {
      // SSR still renders dark; the post-hydration effect then flips it.
      await libraryPage.reload();
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "light",
      );
    });
  });

  test("persist the black theme across a reload", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("choose the black theme", async () => {
      await libraryPage.goto();
      await expect(libraryPage.themeRoot).toHaveAttribute("data-theme", "dark");
      await topNav.openUserMenu();
      await topNav.selectTheme("black");
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "black",
      );
      expect(await libraryPage.storedTheme()).toBe("black");
    });

    await test.step("reload", async () => {
      await libraryPage.reload();
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "black",
      );
    });
  });

  test("flip back to dark after choosing light", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("choose the light theme", async () => {
      await libraryPage.goto();
      // Selecting a theme leaves the menu open, so a second choice needs no reopen.
      await topNav.openUserMenu();
      await topNav.selectTheme("light");
      await expect(libraryPage.themeRoot).toHaveAttribute(
        "data-theme",
        "light",
      );
    });

    await test.step("choose the dark theme", async () => {
      await topNav.selectTheme("dark");
      await expect(libraryPage.themeRoot).toHaveAttribute("data-theme", "dark");
      expect(await libraryPage.storedTheme()).toBe("dark");
    });
  });

  test("switch the theme from preferences and persist it", async ({
    settingsPage,
  }) => {
    const { account } = settingsPage;

    await test.step("open the preferences section", async () => {
      await settingsPage.goto("preferences");
      await expect(settingsPage.themeRoot).toHaveAttribute(
        "data-theme",
        "dark",
      );
    });

    await test.step("choose the sepia theme", async () => {
      await account.selectTheme("sepia");
    });

    await test.step("check the theme applies, is marked and is stored", async () => {
      await expect(settingsPage.themeRoot).toHaveAttribute(
        "data-theme",
        "sepia",
      );
      await expect(account.themeButton("sepia")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(await settingsPage.storedTheme()).toBe("sepia");
    });
  });
});

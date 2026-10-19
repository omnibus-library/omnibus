import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Playwright launches Chromium with `--hide-scrollbars`, so a `100vw` box that
// overhangs a drawn scrollbar passes every other spec. This file draws them,
// in a window short enough that each page scrolls down, and checks the bar
// takes width so a regression can't pass with nothing to overhang.
test.use({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  viewport: { width: 1280, height: 600 },
});

test.describe("always-on scrollbars", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the library without scrolling sideways", async ({
    libraryPage,
  }) => {
    const { topNav, scroll } = libraryPage;

    await test.step("open the library with scrollbars drawn", async () => {
      await libraryPage.goto();
      await scroll.showClassicScrollbars();
    });

    await test.step("check a scrollbar takes width but nothing scrolls sideways", async () => {
      await topNav.assertDisplayed();
      await expect.poll(() => scroll.scrollbarWidth()).toBeGreaterThan(0);
      expect(await scroll.scrollsSideways()).toBe(false);
    });
  });

  test("open the user menu without scrolling sideways", async ({
    libraryPage,
  }) => {
    const { topNav, scroll } = libraryPage;

    await test.step("open the library with scrollbars drawn", async () => {
      await libraryPage.goto();
      await scroll.showClassicScrollbars();
      await expect.poll(() => scroll.scrollbarWidth()).toBeGreaterThan(0);
    });

    await test.step("open the user menu", async () => {
      await topNav.openUserMenu();
      await expect(topNav.signOutButton).toBeVisible();
    });

    await test.step("check its click-outside scrim stays inside the page", async () => {
      expect(await scroll.scrollsSideways()).toBe(false);
    });
  });

  test("show an author without scrolling sideways", async ({
    authorsIndexPage,
  }) => {
    const { scroll } = authorsIndexPage;

    await test.step("open the authors page with scrollbars drawn", async () => {
      await authorsIndexPage.goto();
      await scroll.showClassicScrollbars();
    });

    await test.step("check a scrollbar takes width but nothing scrolls sideways", async () => {
      await expect(authorsIndexPage.previewName).toBeVisible();
      await expect.poll(() => scroll.scrollbarWidth()).toBeGreaterThan(0);
      expect(await scroll.scrollsSideways()).toBe(false);
    });
  });
});

import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

// The indexer must have filled the `authors` and `series` tables that the
// index queries aggregate over.
test.beforeAll("seed the library", async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

test.describe("authors index", () => {
  test("show the authors index layout", async ({ authorsIndexPage }) => {
    const { topNav } = authorsIndexPage;

    await test.step("open the authors index", async () => {
      await authorsIndexPage.goto();
    });

    await test.step("check the hero and the nav", async () => {
      await authorsIndexPage.assertDisplayed();
      await topNav.assertDisplayed();
      await expect(authorsIndexPage.heading).toContainText("Authors");
      // A top-level route: the nav is the only wayfinding it needs.
      await expect(topNav.breadcrumbNav).toHaveCount(0);
      await expect(topNav.navLink("Authors")).toBeVisible();
    });

    await test.step("check the toolbar and the cards", async () => {
      await expect(authorsIndexPage.filterField).toBeVisible();
      await expect(authorsIndexPage.sortByNameButton).toBeVisible();
      await expect(authorsIndexPage.sortByCountButton).toBeVisible();
      await expect(authorsIndexPage.sortByRecentButton).toBeVisible();
      await expect(authorsIndexPage.readingFilterButton).toBeEnabled();
      await expect(authorsIndexPage.firstCard).toBeVisible();
      expect(await authorsIndexPage.cards.count()).toBeGreaterThan(0);
    });

    await test.step("check an author previews beside the list", async () => {
      await expect(authorsIndexPage.previewName).toBeVisible();
    });
  });

  test("open an author beside the list", async ({
    authorsIndexPage,
    authorPage,
  }) => {
    await test.step("filter to one author and open them", async () => {
      await authorsIndexPage.goto();
      await authorsIndexPage.filterBy("Lovelace");
      await authorsIndexPage.openCard("Ada Lovelace");
    });

    await test.step("check the pane changed and the list stayed", async () => {
      await expect(authorPage.heading).toHaveText("Ada Lovelace");
      await expect(authorsIndexPage.filterField).toHaveValue("Lovelace");
      await expect(authorsIndexPage.card("Ada Lovelace")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });

  test("leave progress unknown when it fails to load", async ({
    authorsIndexPage,
  }) => {
    await test.step("open the index with progress failing", async () => {
      await authorsIndexPage.failReadingProgress();
      await authorsIndexPage.goto();
      await expect(authorsIndexPage.firstCard).toBeVisible();
    });

    await test.step("check nothing claims the reader read nothing", async () => {
      await expect(authorsIndexPage.readingFilterButton).toBeDisabled();
      await expect(authorsIndexPage.firstRowBar).toHaveAttribute(
        "data-state",
        "unknown",
      );
    });

    await test.step("check an author still previews", async () => {
      await expect(authorsIndexPage.previewName).toBeVisible();
    });
  });

  test("filter authors by name", async ({ authorsIndexPage }) => {
    let initialCount = 0;

    await test.step("open the authors index", async () => {
      await authorsIndexPage.goto();
      initialCount = await authorsIndexPage.cards.count();
      expect(initialCount).toBeGreaterThan(1);
    });

    await test.step("filter to one author", async () => {
      await authorsIndexPage.filterBy("Lovelace");
      await expect
        .poll(() => authorsIndexPage.cards.count(), {
          message: "the filter left every author card",
        })
        .toBeLessThan(initialCount);
    });

    await test.step("check only matching cards remain", async () => {
      for (const text of await authorsIndexPage.cards.allTextContents()) {
        expect(text.toLowerCase()).toContain("lovelace");
      }
    });
  });

  test("jump to the matching section from the letter strip", async ({
    authorsIndexPage,
  }) => {
    await test.step("open the authors index", async () => {
      await authorsIndexPage.goto();
      // Ada Lovelace is in the fixtures, so the surname bucket "L" exists.
      await expect(authorsIndexPage.firstCard).toBeVisible();
    });

    await test.step("check the letter is a same-page anchor", async () => {
      await expect(authorsIndexPage.letterLink("L")).toBeVisible();
      await expect(authorsIndexPage.letterLink("L")).toHaveAttribute(
        "href",
        "#letter-L",
      );
    });

    await test.step("click the letter", async () => {
      await authorsIndexPage.jumpToLetter("L");
      await authorsIndexPage.assertJumpedTo("L");
    });
  });

  test("open the author page from a card", async ({
    authorsIndexPage,
    authorPage,
  }) => {
    await test.step("filter to one author", async () => {
      await authorsIndexPage.goto();
      await authorsIndexPage.filterBy("Lovelace");
      await expect(authorsIndexPage.firstCard).toBeVisible();
    });

    await test.step("click the card", async () => {
      // Read first, so the URL check needs no fetch after navigating, which
      // HMR disturbs on a dev server.
      const path = await authorsIndexPage.firstCardPath();
      expect(path).toMatch(/^\/authors\/\d+$/);
      await authorsIndexPage.openFirstCard();
      await authorPage.assertDisplayedFor(path);
    });
  });
});

test.describe("series index", () => {
  test("show the series index layout", async ({ seriesIndexPage }) => {
    const { topNav } = seriesIndexPage;

    await test.step("open the series index", async () => {
      await seriesIndexPage.goto();
    });

    await test.step("check the hero and the nav", async () => {
      await seriesIndexPage.assertDisplayed();
      await topNav.assertDisplayed();
      await expect(seriesIndexPage.heading).toContainText("series");
      await expect(topNav.breadcrumbNav).toHaveCount(0);
    });

    await test.step("check the toolbar and the cards", async () => {
      await expect(seriesIndexPage.filterField).toBeVisible();
      await expect(seriesIndexPage.sortByNameButton).toBeVisible();
      await expect(seriesIndexPage.sortByCountButton).toBeVisible();
      await expect(seriesIndexPage.firstCard).toBeVisible();
      expect(await seriesIndexPage.cards.count()).toBeGreaterThan(0);
    });
  });

  test("filter series by name", async ({ seriesIndexPage }) => {
    let initialCount = 0;

    await test.step("open the series index", async () => {
      await seriesIndexPage.goto();
      initialCount = await seriesIndexPage.cards.count();
    });

    await test.step("filter to one series", async () => {
      await seriesIndexPage.filterBy("Pioneers");
      await expect
        .poll(() => seriesIndexPage.cards.count(), {
          message: "the filter left more series cards than before",
        })
        .toBeLessThanOrEqual(initialCount);
    });

    await test.step("check only matching cards remain", async () => {
      for (const text of await seriesIndexPage.cards.allTextContents()) {
        expect(text.toLowerCase()).toContain("pioneer");
      }
    });
  });

  test("open the series page from a card", async ({
    seriesIndexPage,
    seriesPage,
  }) => {
    await test.step("filter to one series", async () => {
      await seriesIndexPage.goto();
      // Hydration can lag network idle, so wait for the cards before filtering.
      await expect(seriesIndexPage.firstCard).toBeVisible();
      await seriesIndexPage.filterBy("Pioneers");
      await expect(seriesIndexPage.firstCard).toBeVisible();
    });

    await test.step("click the card", async () => {
      await seriesIndexPage.openFirstCard();
      await seriesPage.assertDisplayed();
    });
  });
});

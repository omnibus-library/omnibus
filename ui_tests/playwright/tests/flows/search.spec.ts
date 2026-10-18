import { search } from "../contracts/search";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fixturesDir, seedLibrary } from "../utils/seed";

test.beforeAll("seed the library", async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

test.describe("search from the palette", () => {
  test("show matching book results in the palette", async ({ libraryPage }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("search for a title", async () => {
      await libraryPage.goto();
      await palette.search("dracula");
    });

    await test.step("check a book matches", async () => {
      await expect(palette.row("book")).not.toHaveCount(0);
    });
  });

  test("show author results when searching by author", async ({
    libraryPage,
  }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("search for an author", async () => {
      await libraryPage.goto();
      await palette.search("shakespeare");
    });

    await test.step("check an author matches", async () => {
      await expect(palette.row("author")).not.toHaveCount(0);
    });
  });

  test("clear the results when the search is cleared", async ({
    libraryPage,
  }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("search for a title", async () => {
      await libraryPage.goto();
      await palette.search("dracula");
      await expect(palette.row("book")).not.toHaveCount(0);
    });

    await test.step("clear the search", async () => {
      await palette.clear();
      await expect(palette.row("book")).toHaveCount(0);
    });
  });

  test("leave the search trigger off the settings page", async ({
    settingsPage,
  }) => {
    await test.step("open settings", async () => {
      await settingsPage.goto();
    });

    await test.step("check the nav has no search trigger", async () => {
      await expect(settingsPage.topNav.searchButton).toHaveCount(0);
    });
  });

  test("show author results for part of a name", async ({ libraryPage }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("search for part of an author's name", async () => {
      await libraryPage.goto();
      await palette.search("shakespeare");
    });

    await test.step("check an author matches", async () => {
      await expect(palette.row("author")).not.toHaveCount(0);
    });
  });

  test("show tag or book results for a tag", async ({ libraryPage }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("search for a tag", async () => {
      await libraryPage.goto();
      await palette.search("vampires");
    });

    await test.step("check a tag or a book matches", async () => {
      // "Vampires" is a tag on Dracula, so it surfaces as a tag or as the book.
      await expect
        .poll(
          async () =>
            (await palette.row("tag").count()) +
            (await palette.row("book").count()),
          { message: "no tag or book result for the tag" },
        )
        .toBeGreaterThanOrEqual(1);
    });
  });
});

test.describe("search results page", () => {
  test("show the search results layout", async ({ searchResultsPage }) => {
    const { topNav } = searchResultsPage;

    await test.step("open the results for a query", async () => {
      await searchResultsPage.goto("dracula");
    });

    await test.step("check the nav is the way back", async () => {
      await searchResultsPage.assertDisplayed();
      await topNav.assertDisplayed();
      await expect(topNav.breadcrumbNav).toHaveCount(0);
    });

    await test.step("check the heading and stat line", async () => {
      await expect(searchResultsPage.heading).toContainText(/dracula/i);
      await expect(searchResultsPage.resultCountText).toHaveCount(1);
      await expect(searchResultsPage.resultCountText).toContainText(/fts5/);
    });

    await test.step("check the hits and the jump rail", async () => {
      await expect(searchResultsPage.bookRows).not.toHaveCount(0);
      await expect(searchResultsPage.highlightedTermText).toBeVisible();
      await expect(searchResultsPage.jumpRailHeading).toBeVisible();
    });

    await test.step("check the head has no controls that do nothing", async () => {
      // Relevance, Table and Grid once swallowed clicks with no handler (#2453).
      await expect(searchResultsPage.relevanceSortButton).toHaveCount(0);
      await expect(searchResultsPage.tableViewButton).toHaveCount(0);
      await expect(searchResultsPage.gridViewButton).toHaveCount(0);
    });
  });

  test("reach every hit of a section through Show all", async ({
    searchResultsPage,
    expectMutation,
  }) => {
    let total = 0;

    await test.step("open results that outrun the preview", async () => {
      // "the" matches more fixture titles than the five a section previews.
      await searchResultsPage.goto("the");
      await expect(searchResultsPage.showAllBooksButton).toHaveText(
        /^Show all \d+$/,
      );
      total = await searchResultsPage.showAllBooksCount();
      expect(total, "the query must outrun the preview").toBeGreaterThan(5);
      await expect(searchResultsPage.bookRows).toHaveCount(5);
      await expect(searchResultsPage.showAllBooksButton).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    await test.step("check the rail names the same count", async () => {
      await expect(searchResultsPage.railBooksLink).toContainText(
        String(total),
      );
    });

    await test.step("expand the books section", async () => {
      // A read, but a POST, so it is asserted like one.
      await expectMutation(search.results({ q: "the", limit: total }), () =>
        searchResultsPage.toggleShowAllBooks(),
      );
      await expect(searchResultsPage.bookRows).toHaveCount(total);
      await expect(searchResultsPage.showAllBooksButton).toHaveText(
        "Show fewer",
      );
      await expect(searchResultsPage.showAllBooksButton).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    await test.step("collapse it without a second fetch", async () => {
      await searchResultsPage.toggleShowAllBooks();
      await expect(searchResultsPage.bookRows).toHaveCount(5);
    });
  });

  test("leave the section collapsed and say so when Show all fails", async ({
    searchResultsPage,
    expectMutation,
  }) => {
    await test.step("open the results", async () => {
      await searchResultsPage.goto("the");
      await searchResultsPage.forceServerError(search.results());
    });

    await test.step("expand the books section", async () => {
      await expectMutation(failing(search.results()), () =>
        searchResultsPage.toggleShowAllBooks(),
      );
    });

    await test.step("check the failure shows and the section stays collapsed", async () => {
      await expect(searchResultsPage.sectionErrorMessage).toBeVisible();
      await expect(searchResultsPage.bookRows).toHaveCount(5);
      await expect(searchResultsPage.showAllBooksButton).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });
});

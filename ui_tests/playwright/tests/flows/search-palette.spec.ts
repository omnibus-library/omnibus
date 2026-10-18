import { search } from "../contracts/search";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { fixturesDir, seedLibrary } from "../utils/seed";

test.describe("search palette", () => {
  test("show the search trigger layout", async ({ libraryPage }) => {
    const { topNav } = libraryPage;

    await test.step("open the library", async () => {
      await libraryPage.goto();
    });

    await test.step("check the nav offers search", async () => {
      await libraryPage.assertDisplayed();
      await topNav.assertDisplayed();
      await expect(topNav.searchButton).toBeVisible();
      await expect(topNav.searchButton).toHaveText(/Search/);
    });
  });

  test("open on clicking the search button", async ({ libraryPage }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("click the search button", async () => {
      await libraryPage.goto();
      await palette.open();
    });

    await test.step("check the palette is open", async () => {
      await expect(palette.panel).toBeVisible();
    });
  });

  test("open on Cmd+K", async ({ libraryPage }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("press Cmd+K", async () => {
      await libraryPage.goto();
      await palette.openWithShortcut();
    });

    await test.step("check the palette is open", async () => {
      await expect(palette.panel).toBeVisible();
    });
  });

  for (const destination of ["Authors", "Series"] as const) {
    test(`open on Cmd+K after navigating to the ${destination.toLowerCase()} page`, async ({
      libraryPage,
    }) => {
      const { topNav } = libraryPage;
      const palette = topNav.searchPalette;

      await test.step(`follow the nav link to ${destination}`, async () => {
        await libraryPage.goto();
        // In-app navigation, not a reload: a reload re-runs App and masks the bug.
        await topNav.open(destination);
      });

      await test.step("press Cmd+K", async () => {
        await palette.openWithShortcut();
        await expect(palette.panel).toBeVisible();
      });
    });
  }

  test("close on Escape", async ({ libraryPage }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("open the palette", async () => {
      await libraryPage.goto();
      await palette.open();
      await expect(palette.panel).toBeVisible();
      // Escape is handled by the panel, so it needs the focus the input takes a frame after mount.
      await expect(palette.input).toBeFocused();
    });

    await test.step("press Escape", async () => {
      await palette.closeWithEscape();
      await expect(palette.panel).toHaveCount(0);
    });
  });

  test("close on a click outside the panel", async ({ libraryPage }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("open the palette", async () => {
      await libraryPage.goto();
      await palette.open();
      await expect(palette.panel).toBeVisible();
    });

    await test.step("click outside the panel", async () => {
      await palette.clickPageBackground();
      await expect(palette.panel).toHaveCount(0);
    });

    await test.step("check the click did not reach the page", async () => {
      await libraryPage.assertDisplayed();
    });
  });

  test("focus the input after the search button so typing works immediately", async ({
    libraryPage,
  }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("open the palette", async () => {
      await libraryPage.goto();
      await palette.open();
      await expect(palette.panel).toBeVisible();
      // Typing before the focus lands a frame after mount drops the first keystroke.
      await expect(palette.input).toBeFocused();
    });

    await test.step("type without clicking the input", async () => {
      await palette.typeWithoutFocusing("dracula");
      await expect(palette.input).toHaveValue("dracula");
    });
  });

  test("focus the input after Cmd+K so typing works immediately", async ({
    libraryPage,
  }) => {
    const palette = libraryPage.topNav.searchPalette;

    await test.step("open the palette", async () => {
      await libraryPage.goto();
      await palette.openWithShortcut();
      await expect(palette.panel).toBeVisible();
      // Typing before the focus lands a frame after mount drops the first keystroke.
      await expect(palette.input).toBeFocused();
    });

    await test.step("type without clicking the input", async () => {
      await palette.typeWithoutFocusing("hello");
      await expect(palette.input).toHaveValue("hello");
    });
  });

  // Settings match in the browser, so no library is needed.
  test.describe("settings results", () => {
    test("show a matching setting before the library answers and open its section", async ({
      libraryPage,
      settingsPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;

      const release =
        await test.step("search for a setting while the library search is held", async () => {
          await libraryPage.goto();
          const release = await palette.holdLibrarySearch();
          await palette.search("kobo");
          return release;
        });

      await test.step("check the setting shows without the result count", async () => {
        await expect(palette.row("setting")).toHaveCount(1);
        await expect(palette.row("setting")).toContainText("Kobo devices");
        await expect(palette.row("setting")).toContainText(
          "Settings \u203A Devices",
        );
        await expect(palette.resultCountText).toHaveCount(0);
      });

      await test.step("open the setting", async () => {
        await palette.chooseTopResult("setting");
        await settingsPage.assertDisplayedFor("devices");
        await expect(palette.panel).toHaveCount(0);
      });

      await test.step("release the library search", async () => {
        await release();
      });
    });

    test("reach a server setting with the arrow keys and open it with Enter", async ({
      libraryPage,
      adminPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a setting only a setting answers", async () => {
        await libraryPage.goto();
        await palette.search("smtp");
      });

      // The count includes the setting, so waiting on it also lets the library's
      // answer land before the arrow press, which would otherwise reset it.
      await test.step("check the setting is counted and named", async () => {
        await expect(palette.resultCountText).toContainText(/^1 result /);
        await expect(palette.row("setting")).toContainText(
          "Email delivery (SMTP)",
        );
        await expect(palette.row("setting")).toContainText(
          "Administration \u203A Integrations",
        );
      });

      // Settings list last, so the first Up lands on one.
      await test.step("select it with the arrow key", async () => {
        await palette.selectPreviousResult();
        await expect(palette.row("setting")).toHaveClass(/selected/);
      });

      await test.step("open it with Enter", async () => {
        await palette.submit();
        await adminPage.assertDisplayedFor("integrations");
      });
    });
  });

  test.describe("with the seeded library", () => {
    test.beforeAll("seed the library", async ({ request }) => {
      await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
    });

    test("show book results", async ({ libraryPage }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a title", async () => {
        await libraryPage.goto();
        await palette.search("dracula");
      });

      await test.step("check a book matches", async () => {
        await expect(palette.row("book")).not.toHaveCount(0);
      });
    });

    test("show author results", async ({ libraryPage }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for an author", async () => {
        await libraryPage.goto();
        await palette.search("stoker");
      });

      await test.step("check an author matches", async () => {
        await expect(palette.row("author")).not.toHaveCount(0);
      });
    });

    test("show the result count and timing", async ({ libraryPage }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a title", async () => {
        await libraryPage.goto();
        await palette.search("dracula");
      });

      await test.step("check the meta line", async () => {
        await expect(palette.resultCountText).toHaveCount(1);
        await expect(palette.resultCountText).toContainText(/result/);
        await expect(palette.resultCountText).toContainText(/ms/);
      });

      await test.step("check the meta line shares the group heads' gutter", async () => {
        // The meta line sits beside the results list, so only its padding shows it carries the gutter.
        const metaPad = await palette.leftPadding(palette.resultCountText);
        const headPad = await palette.leftPadding(palette.booksGroupHeading);
        expect(metaPad).toBe(headPad);
        expect(metaPad).not.toBe("0px");
      });
    });

    test("report a failed search on the panel gutter", async ({
      libraryPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;
      let metaPad = "";

      await test.step("run a search that succeeds", async () => {
        await libraryPage.goto();
        await palette.search("dracula");
        await expect(palette.resultCountText).toHaveCount(1);
        // The error takes the slot the meta line fills on the happy path.
        metaPad = await palette.leftPadding(palette.resultCountText);
      });

      await test.step("run a search that fails", async () => {
        await libraryPage.forceServerError(search.palette());
        await palette.replaceQuery("stoker");
      });

      await test.step("check the error sits on the same gutter", async () => {
        await expect(palette.errorMessage).toBeVisible();
        await expect(palette.errorMessage).toContainText(
          /Couldn.t run that search/,
        );
        await expect(palette.resultCountText).toHaveCount(0);
        const alertPad = await palette.leftPadding(palette.errorMessage);
        expect(alertPad).toBe(metaPad);
        expect(alertPad).not.toBe("0px");
      });
    });

    test("open a book from its result", async ({
      libraryPage,
      bookDetailPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a title", async () => {
        await libraryPage.goto();
        await palette.search("dracula");
        await expect(palette.row("book")).not.toHaveCount(0);
      });

      await test.step("click the top book", async () => {
        await palette.chooseTopResult("book");
        await bookDetailPage.assertDisplayedByUuid();
      });
    });

    test("highlight results with the arrow keys", async ({ libraryPage }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a title", async () => {
        await libraryPage.goto();
        await palette.search("dracula");
        await expect(palette.row("book")).not.toHaveCount(0);
      });

      await test.step("press the down arrow", async () => {
        await palette.selectNextResult();
        await expect(palette.topResult("book")).toHaveClass(/selected/);
      });
    });

    test("open an author from its result", async ({
      libraryPage,
      authorPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for an author", async () => {
        await libraryPage.goto();
        await palette.search("stoker");
        await expect(palette.row("author")).not.toHaveCount(0);
      });

      await test.step("click the top author", async () => {
        await palette.chooseTopResult("author");
        await authorPage.assertDisplayed();
      });
    });

    test("open a series from its result", async ({
      libraryPage,
      seriesPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a series", async () => {
        await libraryPage.goto();
        await palette.search("pioneers");
        await expect(palette.row("series")).not.toHaveCount(0);
      });

      await test.step("click the top series", async () => {
        await palette.chooseTopResult("series");
        await seriesPage.assertDisplayed();
      });
    });

    test("go to the full results when Enter is pressed without an arrow key", async ({
      libraryPage,
      searchResultsPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a title", async () => {
        await libraryPage.goto();
        await palette.search("dracula");
        await expect(palette.row("book")).not.toHaveCount(0);
      });

      await test.step("press Enter", async () => {
        await palette.submit();
        await searchResultsPage.assertDisplayedFor("dracula");
      });
    });

    test("drill into the highlighted result when Enter follows an arrow key", async ({
      libraryPage,
      bookDetailPage,
    }) => {
      const palette = libraryPage.topNav.searchPalette;

      await test.step("search for a title", async () => {
        await libraryPage.goto();
        await palette.search("dracula");
        await expect(palette.row("book")).not.toHaveCount(0);
      });

      await test.step("press the down arrow and Enter", async () => {
        await palette.selectNextResult();
        await palette.submit();
        await bookDetailPage.assertDisplayedByUuid();
      });
    });
  });
});

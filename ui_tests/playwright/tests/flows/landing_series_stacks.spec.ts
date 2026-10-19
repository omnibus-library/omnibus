import { account } from "../contracts/account";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

const PIONEERS = ["beta", "gamma", "pioneers-3", "pioneers-4", "pioneers-5"];
const CODE_QUARTET = [
  "code-quartet-1",
  "code-quartet-2",
  "code-quartet-3",
  "code-quartet-4",
];
const PIONEERS_STACK = "Pioneers, 5 books";
const CODE_QUARTET_STACK = "Code Quartet, 4 books";

// Stack series is per-account, so these tests run as the worker's reader (see
// 04a), and the fixture turns it off after each.
test.describe("series stacks", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test.beforeEach(
    "start with stack series off",
    async ({ presetStackSeries }) => {
      await presetStackSeries(false, "reader");
    },
  );

  test("show the stack series layout", async ({ readerLibraryPage }) => {
    await test.step("open the library", async () => {
      await readerLibraryPage.goto();
    });

    await test.step("check the switch is off with every volume tiled", async () => {
      await expect(readerLibraryPage.stackToggle).toBeEnabled();
      await expect(readerLibraryPage.stackToggle).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(readerLibraryPage.stackTiles).toHaveCount(0);
      for (const slug of PIONEERS) {
        await expect(readerLibraryPage.volumeTile(slug)).toBeVisible();
      }
      await readerLibraryPage.topNav.assertDisplayed();
    });
  });

  test("turn stack series on to fold each series into one counted tile", async ({
    readerLibraryPage,
    readerExpectMutation,
  }) => {
    await test.step("open the library", async () => {
      await readerLibraryPage.goto();
    });

    await test.step("turn the switch on", async () => {
      await readerExpectMutation(account.stackSeries(true), () =>
        readerLibraryPage.toggleStackSeries(),
      );
      await expect(readerLibraryPage.stackToggle).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await test.step("check each series folds into one tile", async () => {
      await expect(readerLibraryPage.seriesStack(PIONEERS_STACK)).toContainText(
        "5 books",
      );
      // The list item is the grid cell itself, never a `display: contents` shell.
      await expect(readerLibraryPage.stackCell(PIONEERS_STACK)).toHaveCSS(
        "display",
        "block",
      );
      await expect(
        readerLibraryPage.seriesStack(CODE_QUARTET_STACK),
      ).toContainText("4 books");
      for (const slug of [...PIONEERS, ...CODE_QUARTET]) {
        await expect(readerLibraryPage.volumeTile(slug)).toHaveCount(0);
      }
    });
  });

  test("open a stack to deal its volumes out behind a head card", async ({
    readerLibraryPage,
    presetStackSeries,
  }) => {
    const cap = readerLibraryPage.seriesCap;
    await presetStackSeries(true, "reader");

    await test.step("open the library", async () => {
      await readerLibraryPage.goto();
    });

    await test.step("open the Pioneers stack", async () => {
      await readerLibraryPage.openSeriesStack(PIONEERS_STACK);
    });

    await test.step("check the volumes are dealt out behind the head card", async () => {
      await expect(cap.root).toBeVisible();
      await expect(cap.root).toContainText("Pioneers");
      await expect(cap.root).toContainText("5 in your library");
      for (const slug of PIONEERS) {
        await expect(readerLibraryPage.volumeTile(slug)).toBeVisible();
      }
      await expect(cap.foldButton).toBeFocused();
    });
  });

  test("fold an open stack with escape", async ({
    readerLibraryPage,
    presetStackSeries,
  }) => {
    const cap = readerLibraryPage.seriesCap;
    await presetStackSeries(true, "reader");

    await test.step("open the Pioneers stack", async () => {
      await readerLibraryPage.goto();
      await readerLibraryPage.openSeriesStack(PIONEERS_STACK);
      await expect(cap.foldButton).toBeFocused();
    });

    await test.step("press escape", async () => {
      await cap.foldWithEscape();
    });

    await test.step("check the stack folds and keeps focus", async () => {
      await expect(cap.root).toHaveCount(0);
      await expect(readerLibraryPage.seriesStack(PIONEERS_STACK)).toBeVisible();
      await expect(readerLibraryPage.seriesStack(PIONEERS_STACK)).toBeFocused();
      for (const slug of PIONEERS) {
        await expect(readerLibraryPage.volumeTile(slug)).toHaveCount(0);
      }
    });

    // The returning stack tile must not replay the wall's mount sweep on top
    // of its own FLIP fade.
    await test.step("check the wall's sweep does not replay", async () => {
      await expect
        .poll(() => readerLibraryPage.sweepAnimationCount(PIONEERS_STACK))
        .toBe(0);
    });
  });

  test("move the rest of the wall rather than rebuilding it when a stack opens", async ({
    readerLibraryPage,
    presetStackSeries,
  }) => {
    await presetStackSeries(true, "reader");

    await test.step("open the library and mark its cells", async () => {
      await readerLibraryPage.goto();
      await readerLibraryPage.markGridCells();
    });

    await test.step("open the Pioneers stack", async () => {
      await readerLibraryPage.openSeriesStack(PIONEERS_STACK);
      await expect(readerLibraryPage.seriesCap.root).toBeVisible();
    });

    await test.step("check only the head card and its volumes are new", async () => {
      expect(await readerLibraryPage.countUnmarkedGridCells()).toBe(
        1 + PIONEERS.length,
      );
      // The deal-out motion owns a volume's entrance, not the wall's sweep-in.
      await expect(readerLibraryPage.volumeTile("beta")).toHaveCSS(
        "animation-name",
        "none",
      );
    });
  });

  test("flip the sort without reopening a run or moving focus", async ({
    readerLibraryPage,
    presetStackSeries,
    request,
  }) => {
    const asc = `stack-${await fetchBookUuidByTitle(request, "Beta in the Series")}`;
    const desc = `stack-${await fetchBookUuidByTitle(request, "Pioneers Vol 5: Signal")}`;
    await presetStackSeries(true, "reader");

    await test.step("open the library with the stack dealt out", async () => {
      await readerLibraryPage.goto();
      await expect(readerLibraryPage.sortDirectionButton).toHaveAccessibleName(
        "Sort direction: ascending",
      );
      await expect
        .poll(() => readerLibraryPage.stackLeadKey(PIONEERS_STACK))
        .toBe(asc);
      await readerLibraryPage.openSeriesStack(PIONEERS_STACK);
      await expect(readerLibraryPage.seriesCap.root).toBeVisible();
    });

    // The folded stack's lead moves with the sort, and is null while it is dealt out.
    await test.step("flip the sort there and back", async () => {
      for (const leadKey of [desc, asc]) {
        await readerLibraryPage.toggleSortDirection();
        await expect
          .poll(() => readerLibraryPage.stackLeadKey(PIONEERS_STACK))
          .toBe(leadKey);
      }
      await expect(readerLibraryPage.seriesCap.root).toHaveCount(0);
      await expect(readerLibraryPage.sortDirectionButton).toBeFocused();
    });

    // A fold's refocus is spent on the tile it returns to.
    await test.step("fold the stack and flip the sort again", async () => {
      await readerLibraryPage.openSeriesStack(PIONEERS_STACK);
      await expect(readerLibraryPage.seriesCap.foldButton).toBeFocused();
      await readerLibraryPage.seriesCap.foldWithEscape();
      await expect(readerLibraryPage.seriesStack(PIONEERS_STACK)).toBeFocused();
      for (const leadKey of [desc, asc]) {
        await readerLibraryPage.toggleSortDirection();
        await expect
          .poll(() => readerLibraryPage.stackLeadKey(PIONEERS_STACK))
          .toBe(leadKey);
      }
      await expect(readerLibraryPage.sortDirectionButton).toBeFocused();
    });
  });

  test("link the head card to the series page", async ({
    readerLibraryPage,
    readerSeriesPage,
    presetStackSeries,
  }) => {
    await presetStackSeries(true, "reader");

    await test.step("open the Pioneers stack", async () => {
      await readerLibraryPage.goto();
      await readerLibraryPage.openSeriesStack(PIONEERS_STACK);
    });

    await test.step("follow the head card's link", async () => {
      await readerLibraryPage.seriesCap.openSeriesPage();
    });

    await test.step("check the series page opens", async () => {
      await readerSeriesPage.assertShowsSeries("Pioneers");
    });
  });

  test("keep the saved stack choice across table view", async ({
    readerLibraryPage,
    presetStackSeries,
  }) => {
    await presetStackSeries(true, "reader");

    await test.step("switch to the table", async () => {
      await readerLibraryPage.goto();
      await readerLibraryPage.table.switchTo();
      await expect(readerLibraryPage.stackToggle).toHaveCount(0);
    });

    // The switch is hidden, not off: the saved choice comes back with the grid.
    await test.step("switch back to the grid", async () => {
      await readerLibraryPage.switchToGrid();
      await expect(readerLibraryPage.stackToggle).toBeEnabled();
      await expect(readerLibraryPage.stackToggle).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(readerLibraryPage.seriesStack(PIONEERS_STACK)).toBeVisible();
    });
  });

  test("keep the switch across a reload", async ({
    readerLibraryPage,
    readerExpectMutation,
  }) => {
    await test.step("turn the switch on", async () => {
      await readerLibraryPage.goto();
      await readerExpectMutation(account.stackSeries(true), () =>
        readerLibraryPage.toggleStackSeries(),
      );
    });

    await test.step("reload the page", async () => {
      await readerLibraryPage.reload();
    });

    await test.step("check the switch is still on", async () => {
      await expect(readerLibraryPage.stackToggle).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(readerLibraryPage.seriesStack(PIONEERS_STACK)).toBeVisible();
    });
  });

  // The suite's admin never stacked, so its wall still tiles every volume.
  test("save the switch per user", async ({
    libraryPage,
    presetStackSeries,
  }) => {
    await test.step("turn the switch on as the reader", async () => {
      await presetStackSeries(true, "reader");
    });

    await test.step("check the admin's wall is unchanged", async () => {
      await libraryPage.goto();
      await expect(libraryPage.volumeTile("beta")).toBeVisible();
      await expect(libraryPage.stackTiles).toHaveCount(0);
    });
  });

  test("put the switch back when a save fails", async ({
    readerLibraryPage,
    presetStackSeries,
    readerExpectMutation,
  }) => {
    await presetStackSeries(true, "reader");

    await test.step("open the library with the switch on", async () => {
      await readerLibraryPage.goto();
      await expect(readerLibraryPage.stackToggle).toBeEnabled();
    });

    await test.step("turn the switch off while the server fails", async () => {
      await readerLibraryPage.forceServerError(account.stackSeries());
      await readerExpectMutation(failing(account.stackSeries(false)), () =>
        readerLibraryPage.toggleStackSeries(),
      );
    });

    await test.step("check the switch is back on with an error shown", async () => {
      await expect(readerLibraryPage.stackToggle).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(readerLibraryPage.stackError).toBeVisible();
      await expect(readerLibraryPage.seriesStack(PIONEERS_STACK)).toBeVisible();
    });
  });
});
